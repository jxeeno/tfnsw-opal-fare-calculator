import REF_NETWORKS from "./ref/networks.json";
import { OpalNetwork, OpalFareComponent, OpalFareTap, OpalFareTransactionType, OpalIntramodalJourneySegmentGroup } from './opal.types';
import { EfaRapidJsonLegPartial, EfaRapidJsonStopPartial } from "./efa.types";
import { DateTime, Duration } from 'luxon';
import distance from "@turf/distance";

export class OpalFareCalculator {
    constructor(){}

    taps: OpalFareTap[] = [];
    legFares: {[k: string]: OpalFareComponent[]} = {};
    legs: EfaRapidJsonLegPartial[] = [];
    allLegs: EfaRapidJsonLegPartial[] = [];
    intramodalJourneySegmentGroups: OpalIntramodalJourneySegmentGroup[] = [];

    /**
     * 
     * Returns the valid Opal Network configuration object for a given tap on time
     *
     * @param time - a Javascript Date object representing the tap on time
     * @returns an OpalNetwork object
     *
     */
    static getNetworkForTime(time?: Date){
        const networks = REF_NETWORKS as OpalNetwork[];
        for(const network of networks){
            const {date} = this.getOpalDate(network, time ?? new Date());
            if(date >= network.CONFIG.VALID_FROM && date <= network.CONFIG.VALID_TO){
                return network;
            }
        }
        
        // otherwise, return the last network
        return networks[networks.length-1]
    }

    /**
     * 
     * Returns whether a leg from the EFA trip planner response is the Stockton ferry
     *
     * @param leg - an EFA trip planner leg
     * @returns true if it's the Stockton ferry, false for all other legs
     *
     */
    static isLegStocktonFerry(leg: EfaRapidJsonLegPartial){
        return (leg.transportation.product.class === 9 && ['3000'].includes(leg.transportation.operator.id))
    }

    /**
     * 
     * Returns the mode of transport used for Opal calculations from an EFA leg
     *
     * @param leg - The leg from Trip Planner API
     * @returns mode of transport (string)
     *
     */
    static getOpalModeOfTransportForLeg(leg: EfaRapidJsonLegPartial){
        // Metro
        if (leg.transportation.product.class === 2) {
            return 'RAIL'
        }

        // Sydney Trains and NSW Trains Intercity (Opal Network)
        if (
            leg.transportation.product.class === 1 &&
            ['X000', 'X0000', 'x0001'].includes(leg.transportation.operator.id)
        ) {
            return 'RAIL'
        }

        // Manly Fast Ferry
        if (
            leg.transportation.product.class === 9 &&
            ['306'].includes(leg.transportation.operator.id)
        ) {
            return 'FERRY'
        }

        // Sydney Ferries
        if (
            leg.transportation.product.class === 9 &&
            ['SF'].includes(leg.transportation.operator.id)
        ) {
            return 'FERRY'
        }

        // Light Rail
        if (
            leg.transportation.product.class === 4
        ) {
            return 'LIGHTRAIL'
        }

        // Bus
        // TODO: handle school buses and replacement buses
        if (
            // Regular Opal bus
            (leg.transportation.product.class === 5 && [5, 15].includes(leg.transportation.product.iconId)) ||

            // Stockton Ferry charged as bus fare
            OpalFareCalculator.isLegStocktonFerry(leg)
        ) {
            return 'BUS'
        }

        return 'NON_OPAL'
    }

    /**
     * 
     * Returns the estimated fare distance from a distance matrix
     *
     * @param network - the currently applicable OpalNetwork object
     * @param mode - identifier for the mode used for Opal fare calculations (e.g. RAIL)
     * @param origin - an EFA stop object representing the origin location
     * @param destination - an EFA stop object representing the origin destination
     * @returns distance used for fare calculations in kilometers
     *
     */
    static getFareDistance(network: OpalNetwork, mode: string, origin: EfaRapidJsonStopPartial, destination: EfaRapidJsonStopPartial){
        const originTsn = OpalFareCalculator.getTsnForStop(origin);
        const destinationTsn = OpalFareCalculator.getTsnForStop(destination);
        const odKey = `${originTsn}:${destinationTsn}`;
        if(mode === "RAIL"){
            return (network.DISTANCE_MATRIX.RAIL)[odKey] ?? null;
        }else if(mode === "FERRY"){
            return (network.DISTANCE_MATRIX.FERRY)[odKey] ?? null;
        }
    }

    /**
     * 
     * Returns the base fare to be charged, usually without discounts
     * However, peak and FOU discount can be specified.
     *
     * @param network - the currently applicable OpalNetwork object
     * @param type - fare type (e.g. ADULT)
     * @param mode - identifier for the mode used for Opal fare calculations (e.g. RAIL)
     * @param distance - number of kilometers to calculate the fare for
     * @param isPeak - boolean for whether the fare should be a peak fare
     * @param isFou - boolean for whether the fare has hit the frequency of use threshold
     * @returns base fare to be charged in cents
     *
     */
    static getBaseFare(network: OpalNetwork, type: string, mode: string, distance: number, isPeak: boolean, isFou: boolean) {
        const fareTable = network.FARE_TABLE;
        if(!fareTable[type]) throw new Error(`Fare type ${type} could not be found`);
        
        const modeFares = fareTable[type].MODES[mode];
        if(!modeFares) throw new Error(`Mode ${mode} and fare type ${type} could not be found`);

        const fareKey = (isFou ? 'FOU_' : '') + (isPeak ? 'PEAK' : 'OFFPEAK') as "PEAK"|"OFFPEAK"|"FOU_PEAK"|"FOU_OFFPEAK";

        // use the max band as fallback
        let lastBand;
        for(const band in modeFares){
            if(distance >= modeFares[band].FROM_KM && distance < modeFares[band].TO_KM){
                return modeFares[band][fareKey]
            }
            lastBand = modeFares[band][fareKey];
        }

        if(!lastBand) throw new Error(`No fare found for ${fareKey} with mode ${mode} and fare type ${type}`);

        return lastBand;
    }

    /**
     * 
     * Returns the station access fee to be charged if applicable
     * `0` is returned if no station access fee is charged
     *
     * @param network - the currently applicable OpalNetwork object
     * @param type - fare type (e.g. ADULT)
     * @param origin - an EFA stop object representing the origin location
     * @param destination - an EFA stop object representing the origin destination
     * @returns station access fee to be charged in cents
     *
     */
    static getStationAccessFee(network: OpalNetwork, type: string, origin: EfaRapidJsonStopPartial, destination: EfaRapidJsonStopPartial) {
        const fareTable = network.FARE_TABLE;
        if(!fareTable[type]) throw new Error(`Fare type ${type} could not be found`);

        const originTsn = OpalFareCalculator.getTsnForStop(origin);
        const destinationTsn = OpalFareCalculator.getTsnForStop(destination);

        if(network.SAF_TSN.includes(originTsn) || network.SAF_TSN.includes(destinationTsn)){
            // SAF is applicable
            if(!fareTable[type].SAF) return 0; // TODO: throw error

            const odKey = `${originTsn}:${destinationTsn}`;
            if(fareTable[type].SAF.ALC_RATES[odKey] != null){
                return fareTable[type].SAF.ALC_RATES[odKey]
            }

            return fareTable[type].SAF.NON_ALC_RATE;
        }

        return 0;
    }

    /**
     * 
     * Returns an array of fare types in the current OpalNetwork config
     * e.g. `["ADULT", "CHILD", ...]`
     *
     * @param network - the currently applicable OpalNetwork object
     * @returns array of strings for fare types
     *
     */
    static getFareTypes(network: OpalNetwork){
        const fareTable = network.FARE_TABLE;
        return Object.keys(fareTable);
    }

    /**
     * 
     * Returns the applicable fare parameters for a given fare type
     *
     * @param network - the currently applicable OpalNetwork object
     * @param type - fare type (e.g. ADULT)
     * @returns applicable fare table in the current OpalNetwork for the selected fare type
     *
     */
    static getFareParameters(network: OpalNetwork, type: string) {
        const fareTable = network.FARE_TABLE;
        if(!fareTable[type]) throw new Error(`Fare type ${type} could not be found`);
        
        return fareTable[type];
    }

    /**
     * 
     * Returns the date, day of week and if it is a weekend for Opal purposes
     * as used by Opal for fare calculation
     * 
     * Specifically, this handles:
     * * Opal days starting at 4am
     * * Dynamic day of weeks being the weekend for Opal purposes (Friday included from 16th Oct 2023)
     * * Public holidays are considered weekends for Opal purposes
     *
     * @param network - the currently applicable OpalNetwork object
     * @param date - Javascript date to determine the Opal date for
     * @returns object with date in YYYYMMDD format, day of week as an integer value (1-7) and whether it is an Opal weekend
     *
     */
    static getOpalDate(network: OpalNetwork, date: Date) {
        const zonedTime = DateTime.fromJSDate(date, { zone: network.CONFIG.TZ });
        const opalTime = zonedTime.minus(Duration.fromObject({hours: 4})); // opal day starts at 4am

        const ymd = opalTime.toFormat('yyyyMMdd');
        const dow = opalTime.weekday;

        const isOffPeakDayOfWeek = network.CONFIG.WEEKEND_FARE_DOW.includes(dow);
        const isPublicHoliday = network.TOU.PUBLIC_HOLIDAYS.includes(ymd);

        const isWeekendPH = (isOffPeakDayOfWeek || isPublicHoliday);

        return {date: ymd, dow, isWeekendPH}
    }

    /**
     * 
     * For a given nework, fare type and tap on time, determine the daily fare cap to be applied
     *
     * @param network - the currently applicable OpalNetwork object
     * @param type - fare type (e.g. ADULT)
     * @param date - Javascript date to determine the daily cap for
     * @returns the daily cap amount in cents as an integer
     *
     */
    static getDailyCap(network: OpalNetwork, type: string, time: Date) {
        const params = this.getFareParameters(network, type);
        const opalFareDate = OpalFareCalculator.getOpalDate(network, time);

        if(opalFareDate.isWeekendPH){
            return params.CAPS.WEEKEND_DAILY_CAP
        }

        return params.CAPS.DAILY_CAP
    }

    /**
     * 
     * Returns whether two consecutive legs is eligible for the inter-modal transfer discounts
     * or if the Opal Trip Advantage (intra-modal transfer discount) applies
     *
     * @remarks
     * Assumes arrival time is tap off time and departure time is tap on time
     * 
     * @remarks
     * FIXME: this strongly couples the fare calculations with an EFA leg, we should
     * refactor this to use taps instead
     *
     * @param network - The Opal Network config to use
     * @param prevLeg - The previous leg
     * @param currLeg - The current leg
     * @param transferWalkTime - The time it takes to walk from destination of prev leg to current leg.  This field should only be set if the destination or origin is a station
     * @returns true if eligible for discount
     *
     */
    static isEligibleForTransferDiscount(network: OpalNetwork, prevLeg: EfaRapidJsonLegPartial, currLeg: EfaRapidJsonLegPartial, transferWalkTime: number|null){
        const prevArrivalTime = new Date(prevLeg.destination.arrivalTimeEstimated ?? prevLeg.destination.arrivalTimePlanned).valueOf();
        const currDepartureTime = new Date(currLeg.origin.departureTimeEstimated ?? currLeg.origin.departureTimePlanned).valueOf();

        const prevArrivalOpalYmd = OpalFareCalculator.getOpalDate(network, new Date(prevArrivalTime)).date; // opal day starts at 4am
        const currArrivalOpalYmd = OpalFareCalculator.getOpalDate(network, new Date(currDepartureTime)).date; // opal day starts at 4am

        return (
            // transfer period is max 1 hour
            // TODO: implement CQ-Manly exception
            (currDepartureTime - prevArrivalTime) < 60*60*1000 ||

            // use transfer walk time available
            (transferWalkTime != null && transferWalkTime < 60*60)
        ) && (
            // first tap on new Opal day is always start of new journey
            prevArrivalOpalYmd === currArrivalOpalYmd
        );
    }

    /**
     * 
     * Returns the TSN (Transit Stop Number) for a EFA stop object
     *
     * @remarks
     * Note that this assumes Global ID is being returned by EFA, else it
     * won't be possible to determine the TSN as we do not have a mapping
     * table in this middleware.
     *
     * @param stop - an EFA stop object representing the origin location
     * @returns a string for the TSN if available, otherwise "-1"
     *
     */
    static getTsnForStop(stop: EfaRapidJsonStopPartial) {
        if(stop.type === 'stop' && stop.isGlobalId) return stop.id;
        if(stop.parent?.type === 'stop' && stop.parent?.isGlobalId) return stop.parent.id;
        if(stop.parent?.parent?.type === 'stop' && stop.parent?.parent?.isGlobalId) return stop.parent.parent.id;

        return "-1"
    }

    /**
     * 
     * Returns the approximate location of the stop for a EFA stop object
     *
     * @remarks
     * Assumes coordinates are WGS84 in [lat, lon] format
     *
     * @param stop - an EFA stop object representing the origin location
     * @returns coordinates in array format in [lat, lon] order
     *
     */
    static getCoordForStop(stop: EfaRapidJsonStopPartial) {
        if(stop.type === 'platform' && stop.isGlobalId) return stop.coord.concat().reverse();
        if(stop.parent?.type === 'platform' && stop.parent?.isGlobalId) return stop.parent.coord.concat().reverse();
        if(stop.parent?.parent?.type === 'platform' && stop.parent?.parent?.isGlobalId) return stop.parent.parent.coord.concat().reverse();

        return stop.coord.concat().reverse();
    }

    /**
     * 
     * Returns whether a tap on is to be charged a peak fare
     *
     * @param network - an OpalNetwork object
     * @param tapOnTime - a Javascript Date object representing the tap on time
     * @param tsn - a string repreesenting the Transit Stop Number of the tap on
     * @param mode - identifier for the mode used for Opal fare calculations (e.g. RAIL)
     * @returns true if a tap on should be charged, otherwise false
     *
     */
    static getIsTapOnPeak(network: OpalNetwork, tapOnTime: Date, tsn: string, mode: string) {
        const zonedTime = DateTime.fromJSDate(tapOnTime, { zone: network.CONFIG.TZ });
        const opalFareDate = OpalFareCalculator.getOpalDate(network, tapOnTime);

        if(opalFareDate.isWeekendPH) return false;

        let periods;
        if(mode === 'RAIL'){
            if(network.TOU.OUTER_METRO_STATIONS.includes(tsn)){
                // outer metro
                periods = network.TOU.PEAK_HOURS.OUTER_METRO_PEAK
            }else{
                // metro
                periods = network.TOU.PEAK_HOURS.METRO_PEAK
            }
        }else{
            // non rail and non ferry
            periods = network.TOU.PEAK_HOURS.METRO_PEAK
        }

        const timeOffset = zonedTime.hour * 60 + zonedTime.minute;
        const isWithinRange = (timeOffset: number, range: number[]) => {
            return timeOffset >= range[0] && timeOffset < range[1]
        }

        return (isWithinRange(timeOffset, periods.AM_PEAK) || isWithinRange(timeOffset, periods.PM_PEAK));
    }

    /**
     * 
     * Returns a tap on and tap off pair for an EFA leg
     * 
     * @remarks
     * FIXME: we should accept an array of taps to detect previous tap information
     * instead of using prevLeg. We can refactor this later
     *
     * @param network - an OpalNetwork object
     * @param prevLeg - The previous leg
     * @param currLeg - The current leg
     * @returns an object with tap on and tap off
     *
     */
    static getTapsForLeg(network: OpalNetwork, prevLeg: EfaRapidJsonLegPartial|null|undefined, currLeg: EfaRapidJsonLegPartial, transferWalkTime: number|null) {
        const prevLegKey = !prevLeg ? null : OpalFareCalculator.getOpalModeOfTransportForLeg(prevLeg);
        const currLegKey = OpalFareCalculator.getOpalModeOfTransportForLeg(currLeg);

        // customer can wait at a station or wharf before transferring to the next leg
        // this means we can use the walk time between means of transport as the transfer period
        const canUseTransferWalkTime = (['RAIL', 'FERRY'].includes(prevLegKey ?? '') || ['RAIL', 'FERRY'].includes(currLegKey));

        const isTransfer = (
            prevLeg &&
            OpalFareCalculator.isEligibleForTransferDiscount(
                network,
                prevLeg,
                currLeg,
                canUseTransferWalkTime ? transferWalkTime : null
            )
        );
        const isIntermodalTransfer = isTransfer && prevLegKey !== currLegKey;
        const isIntramodalTransfer = isTransfer && prevLegKey === currLegKey;

        let tapOn = OpalFareTransactionType.TAP_ON_NEW_JOURNEY;
        if(isIntermodalTransfer){
            tapOn = OpalFareTransactionType.TAP_ON_INTERMODAL_TRANSFER
        }else if(isIntramodalTransfer){
            tapOn = OpalFareTransactionType.TAP_ON_INTRAMODAL_TRANSFER
        }

        const originTsn = OpalFareCalculator.getTsnForStop(currLeg.origin);
        const destinationTsn = OpalFareCalculator.getTsnForStop(currLeg.destination);

        const tapOnTime = new Date(currLeg.origin.departureTimeEstimated ?? currLeg.origin.departureTimePlanned);
        const tapOffTime = new Date(currLeg.destination.arrivalTimeEstimated ?? currLeg.destination.arrivalTimePlanned);

        const isPeakTapOn = OpalFareCalculator.getIsTapOnPeak(
            network,
            tapOnTime,
            originTsn,
            currLegKey
        );

        return {
            on: {
                transactionType: tapOn,
                tsn: originTsn,
                mode: currLegKey,
                time: tapOnTime,
                isTapOn: true,
                coords: OpalFareCalculator.getCoordForStop(currLeg.origin),
                isPeakTapOn
            },
            off: {
                transactionType: OpalFareTransactionType.TAP_OFF_DISTANCE_BASED,
                tsn: destinationTsn,
                coords: OpalFareCalculator.getCoordForStop(currLeg.destination),
                mode: currLegKey,
                time: tapOffTime,
                isTapOn: false
            }
        } as {on: OpalFareTap, off: OpalFareTap}
    }

    /**
     * 
     * To add a new leg to calculate fares
     * 
     * @remarks
     * New leg must have a departure time equal to or after the last arrival time
     * 
     * @remarks
     * FIXME: current implementation strongly couples calculation with EFA legs.
     * To refactor some of the logic to decouple calculation of fares from the
     * addition of a EFA leg and use taps instead
     *
     * @param leg - the new leg to add
     * @returns void, leg is accepted
     *
     */
    addLeg(leg: EfaRapidJsonLegPartial){
        const network = OpalFareCalculator.getNetworkForTime(new Date(leg.origin.departureTimeEstimated ?? leg.origin.departureTimePlanned));

        this.allLegs.push(leg);

        const prevLeg = this.legs[this.legs.length-1];
        const taps = OpalFareCalculator.getTapsForLeg(network, prevLeg, leg, null);

        if(taps.on.mode === 'NON_OPAL') return;

        // append leg to array
        this.legs.push(leg);

        // append taps to array
        this.taps.push(taps.on, taps.off);

        // now store legs and taps into intramodal transfer group
        let currentIntramodalJourneySegmentGroup = this.intramodalJourneySegmentGroups[this.intramodalJourneySegmentGroups.length-1];

        if(!currentIntramodalJourneySegmentGroup || ![
            OpalFareTransactionType.TAP_ON_INTRAMODAL_TRANSFER,
            OpalFareTransactionType.TAP_ON_F1_INTRAMODAL_TRANSFER,
        ].includes(taps.on.transactionType)){
            // create a new intramodal journey segment group
            currentIntramodalJourneySegmentGroup = {
                legs: [],
                taps: [],
                fares: {},
                mode: taps.on.mode,
                ...OpalFareCalculator.getOpalDate(network, taps.on.time),
                network
            };
            this.intramodalJourneySegmentGroups.push(currentIntramodalJourneySegmentGroup);
        }

        currentIntramodalJourneySegmentGroup.legs.push(leg);
        currentIntramodalJourneySegmentGroup.taps.push(taps.on, taps.off);

        // now calculate fares for current intramodal journey segments
        const fareTypes = OpalFareCalculator.getFareTypes(network);
        for(const fareType of fareTypes){
            if(!this.legFares[fareType]) this.legFares[fareType] = []
            if(!currentIntramodalJourneySegmentGroup.fares[fareType]) currentIntramodalJourneySegmentGroup.fares[fareType] = []

            const totalFareForIntermodalJourneySegmentGroup = currentIntramodalJourneySegmentGroup.fares[fareType].reduce((pv, fare) => pv + fare.totalAdditionalFareCents, 0);
            const totalSafForIntermodalJourneySegmentGroup = currentIntramodalJourneySegmentGroup.fares[fareType].reduce((pv, fare) => pv + fare.totalAdditionalSafCents, 0);
            
            const intermodalDiscountCents = (
                [
                    OpalFareTransactionType.TAP_ON_INTERMODAL_TRANSFER,
                    OpalFareTransactionType.TAP_ON_F1_INTERMODAL_TRANSFER
                ].includes(currentIntramodalJourneySegmentGroup.taps[0].transactionType) ?
                -OpalFareCalculator.getFareParameters(network, fareType).INTERMODAL_DISCOUNT :
                0
            );

            let shouldLegUsePeakFare = taps.on.isPeakTapOn;
            let permitNegativeAdditionalFare = false;
            let retainHighestFareBand = true;

            // TODO: model ferry same wharf interchanges at CQ
            let stationAccessFeeCents = 0;
            let fareDistance;
            if(currentIntramodalJourneySegmentGroup.mode === 'RAIL'){
                // We will assume no tap out at interchanges
                // Fare distance is first station in group to last staion in group

                const origin = currentIntramodalJourneySegmentGroup.legs[0].origin;
                const destination = currentIntramodalJourneySegmentGroup.legs[
                    currentIntramodalJourneySegmentGroup.legs.length-1
                ].destination;

                fareDistance = OpalFareCalculator.getFareDistance(
                    network,
                    currentIntramodalJourneySegmentGroup.mode,
                    origin, destination
                );

                stationAccessFeeCents = OpalFareCalculator.getStationAccessFee(
                    network,
                    fareType,
                    origin,
                    destination
                );

                shouldLegUsePeakFare = currentIntramodalJourneySegmentGroup.taps[0].isPeakTapOn;

                // virtual tap on will inherit peak status in the first tap of the journey segment group
                taps.on.isPeakTapOn = currentIntramodalJourneySegmentGroup.taps[0].isPeakTapOn;
                
                permitNegativeAdditionalFare = true;
                retainHighestFareBand = false;
            }else{
                // use the longest distance between any two stops
                const tapOns = currentIntramodalJourneySegmentGroup.taps.filter(tap => tap.isTapOn);
                const tapOffs = currentIntramodalJourneySegmentGroup.taps.filter(tap => !tap.isTapOn);

                for(let i = 0; i < tapOns.length; i++){
                    for(let j = 0; j < tapOffs.length; j++){
                        const tapOn = tapOns[i];
                        const tapOff = tapOffs[j];

                        const origin = tapOn.coords;
                        const destination = tapOff.coords;

                        const pairDistance = distance(origin, destination, {units: 'kilometers'});
                        if(fareDistance == null || pairDistance > fareDistance){
                            fareDistance = pairDistance;
                            shouldLegUsePeakFare = tapOn.isPeakTapOn;
                        }
                    }    
                }
            }

            if(fareDistance == null) throw new Error(`Could not calculate fare distance`);

            const baseFareCents = OpalFareCalculator.getBaseFare(
                network,
                fareType,
                currentIntramodalJourneySegmentGroup.mode,
                fareDistance,
                true,
                false
            );

            const baseFareCentsCurrentContext = OpalFareCalculator.getBaseFare(
                network,
                fareType,
                currentIntramodalJourneySegmentGroup.mode,
                fareDistance,
                shouldLegUsePeakFare,
                false
            );

            const dailyCapDiscountCents = 0; // TODO
            const offPeakDiscountCents = baseFareCentsCurrentContext - baseFareCents;

            const fouDiscountCents = 0;
            const complexAdjustmentCents = 0;
            const intramodalDiscountCents = baseFareCents - totalFareForIntermodalJourneySegmentGroup - baseFareCents;

            const fare : OpalFareComponent = {
                type: fareType,
                taps,
                mode: currentIntramodalJourneySegmentGroup.mode,
                distance: fareDistance,
                components: {
                    baseFareCents,
                    fouDiscountCents,
                    intramodalDiscountCents,
                    offPeakDiscountCents,
                    intermodalDiscountCents,
                    dailyCapDiscountCents,
                    stationAccessFeeCents,
                    complexAdjustmentCents
                },
                totalAdditionalFareCents: (
                    baseFareCents +
                    fouDiscountCents +
                    intramodalDiscountCents +
                    offPeakDiscountCents +
                    intermodalDiscountCents +
                    dailyCapDiscountCents
                ),
                totalFareCents: 0,
                totalAdditionalSafCents: stationAccessFeeCents - totalSafForIntermodalJourneySegmentGroup,
                totalSafCents: 0,
                leg
            };

            // do not allow negative fare adjustment (except rail)
            if(fare.totalAdditionalFareCents < 0 && !permitNegativeAdditionalFare){
                const correction = -fare.totalAdditionalFareCents;
                fare.components.complexAdjustmentCents += correction;
                fare.totalAdditionalFareCents = 0;
            }

            // use highest band within segment group (except rail)
            const maxPreviousFare = Math.max(...currentIntramodalJourneySegmentGroup.fares[fareType].map(fare => fare.totalFareCents) ?? [0]);
            if((fare.totalAdditionalFareCents + totalFareForIntermodalJourneySegmentGroup) < maxPreviousFare && retainHighestFareBand){
                const correction = maxPreviousFare - (fare.totalAdditionalFareCents + totalFareForIntermodalJourneySegmentGroup);
                fare.components.complexAdjustmentCents += correction;
                fare.totalAdditionalFareCents += correction;
            }

            // apply daily fare cap
            const dailyCap = OpalFareCalculator.getDailyCap(network, fareType, taps.on.time);
            const totalFareTodayPriorToCurrentLeg = this.intramodalJourneySegmentGroups.filter(group => {
                return group.date === currentIntramodalJourneySegmentGroup.date
            }).reduce((prevValue, group) => prevValue + group.fares[fareType].reduce((prevValue, fare) => prevValue + fare.totalAdditionalFareCents, 0), 0);
            const totalFareToday = totalFareTodayPriorToCurrentLeg + fare.totalAdditionalFareCents;
            if(totalFareToday > dailyCap){
                const correction = -(totalFareToday-dailyCap);
                fare.components.dailyCapDiscountCents += correction;
                fare.totalAdditionalFareCents += correction;
            }

            fare.totalFareCents = (fare.totalAdditionalFareCents + totalFareForIntermodalJourneySegmentGroup);
            fare.totalSafCents = (fare.totalAdditionalSafCents + totalSafForIntermodalJourneySegmentGroup);

            currentIntramodalJourneySegmentGroup.fares[fareType].push(fare);

            this.legFares[fareType].push(fare);
        }
    }

    /**
     * 
     * Exports fare calculation data to an object
     *
     * @returns object of leg fares
     *
     */
    toObject(){
        return {
            fares: this.legFares,
            // totalFare: (this.legFares['ADULT'] ?? []).reduce((pv, fare) => pv + fare.totalAdditionalFareCents, 0)
        }
    }

    /**
     * 
     * Exports an array of EFA-compatible ticket objects
     *
     * @returns array of EFA ticket objects
     *
     */
    toEfaFareObject(){
        const createFareObject = (fare: OpalFareComponent, jsGroup: OpalIntramodalJourneySegmentGroup) => {
            const dollarString = ((fare.totalAdditionalFareCents/100) + fare.totalAdditionalSafCents/100).toFixed(2);
            const safDollarString = fare.totalAdditionalSafCents > 0 ? (fare.totalAdditionalSafCents/100).toFixed(2) : undefined;
            const noSafDollarString = (fare.totalAdditionalFareCents/100).toFixed(2);
            const fareName = OpalFareCalculator.getFareParameters(jsGroup.network, fare.type).NAME;
            const legIdx = this.allLegs.indexOf(fare.leg);
            return {
                "id": `ANYTRIP-EST-${fare.type}-${fare.mode}-${fare.taps.on.isPeakTapOn ? 'PEAK' : 'OFFPEAK'}`, // "REG-BUSES-PEAK",
                "name": "Opal tariff",
                "comment": "",
                "URL": "",
                "currency": "AUD",
                "priceLevel": "0",
                "priceBrutto": Number(noSafDollarString),
                "priceNetto": 0,
                "taxPercent": 0,
                "fromLeg": legIdx,
                "toLeg": legIdx,
                "net": "nsw",
                "person": fare.type,
                "travellerClass": "SECOND",
                "timeValidity": "SINGLE",
                "validMinutes": -1,
                "isShortHaul": "NO",
                "returnsAllowed": "NO",
                "validForOneJourneyOnly": "UNKNOWN",
                "validForOneOperatorOnly": "UNKNOWN",
                "numberOfChanges": jsGroup.legs.length,
                "nameValidityArea": "",
                "validFrom": DateTime.fromFormat(jsGroup.network.CONFIG.VALID_FROM, 'yyyyMMdd').plus(Duration.fromObject({hours: 4})).toUTC().toISO(),
                "validTo": DateTime.fromFormat(jsGroup.network.CONFIG.VALID_TO, 'yyyyMMdd').endOf('day').plus(Duration.fromObject({hours: 4})).toUTC().toISO(),
                "properties": {
                    "riderCategoryName": fareName,
                    "priceStationAccessFee": safDollarString,
                    "priceTotalFare": dollarString,
                    "evaluationTicket": undefined,
                    "distExact": 0,
                    "distRounded": 0,
                    "pricePerKM": 0,
                    "priceBasic": 0,
                    "tariffProductDefault": [],
                    "tariffProductOption": []
                }
            }
        }

        const faresByLeg = this.intramodalJourneySegmentGroups.flatMap(jsGroup => Object.entries(jsGroup.fares).flatMap(([fareType, fares]) => fares.map(fare => createFareObject(fare, jsGroup))));

        const fareTypes = [...new Set(faresByLeg.map(fare => fare.person))];
        const evaluationTicketByTicket = fareTypes.map(fareType => {
            const fares = faresByLeg.filter(fare => fare.person === fareType);
            const cloned = structuredClone(fares[0]);
            cloned.fromLeg = Math.min(...fares.map(fare => fare.fromLeg));
            cloned.toLeg = Math.max(...fares.map(fare => fare.toLeg));
            (cloned.properties as any).evaluationTicket = "nswFareEnabled";
            cloned.priceBrutto = Number(fares.reduce((pv, fare) => pv + Number(fare.priceBrutto), 0).toFixed(2));
            cloned.properties.priceTotalFare = fares.reduce((pv, fare) => pv + Number(fare.properties.priceTotalFare), 0).toFixed(2);
            cloned.properties.priceStationAccessFee = fares.reduce((pv, fare) => pv + Number(fare.properties.priceStationAccessFee ?? 0), 0).toFixed(2);

            if(cloned.properties.priceStationAccessFee === '0.00'){
                cloned.properties.priceStationAccessFee = undefined;
            }
            return cloned;
        });

        return faresByLeg.concat(evaluationTicketByTicket);
    }
}