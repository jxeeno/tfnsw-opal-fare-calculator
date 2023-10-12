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

    static isLegStocktonFerry(leg: EfaRapidJsonLegPartial){
        return (leg.transportation.product.class === 9 && ['3000'].includes(leg.transportation.operator.id))
    }

    /**
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
            ['X0000', 'x0001'].includes(leg.transportation.operator.id)
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
            (leg.transportation.product.class === 5 && [5, 15].includes(leg.transportation.iconId)) ||

            // Stockton Ferry charged as bus fare
            OpalFareCalculator.isLegStocktonFerry(leg)
        ) {
            return 'BUS'
        }

        return 'NON_OPAL'
    }

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

    static getFareTypes(network: OpalNetwork){
        const fareTable = network.FARE_TABLE;
        return Object.keys(fareTable);
    }

    static getFareParameters(network: OpalNetwork, type: string) {
        const fareTable = network.FARE_TABLE;
        if(!fareTable[type]) throw new Error(`Fare type ${type} could not be found`);
        
        return fareTable[type] as {
            NAME: string,
            CAPS: {
                DAILY_CAP: number,
                WEEKEND_DAILY_CAP: number,
                WEEKLY_CAP: number
            },
            INTERMODAL_DISCOUNT: number
        };
    }

    static getOpalDate(network: OpalNetwork, date: Date) {
        const zonedTime = DateTime.fromJSDate(date, { zone: network.CONFIG.TZ });
        const opalTime = zonedTime.minus(Duration.fromObject({hours: 4})); // opal day starts at 4am

        return {date: opalTime.toFormat('yyyyMMdd'), dow: opalTime.weekday}
    }

    static getDailyCap(network: OpalNetwork, type: string, tapOn: OpalFareTap) {
        const params = this.getFareParameters(network, type);
        const opalFareDate = OpalFareCalculator.getOpalDate(network, tapOn.time);

        if(network.CONFIG.WEEKEND_FARE_DOW.includes(opalFareDate.dow)){
            return {amount: params.CAPS.WEEKEND_DAILY_CAP, ymd: opalFareDate.date}
        }

        return {amount: params.CAPS.DAILY_CAP, ymd: opalFareDate.date}
    }

    /**
     * Returns whether two consecutive legs are likely to involve a tap off / tap on event
     *
     * @remarks
     * For rail, this checks whether the station requires tapping off
     *
     * @param prevLeg - The previous leg
     * @param currLeg - The current leg
     * @returns true if a tap off / tap on event is likely to occur, false if not
     *
     */
    static isLikelyOutOfStationInterchange(prevLeg: EfaRapidJsonLegPartial, currLeg: EfaRapidJsonLegPartial){
        // TODO: 
        return false;
    }

    /**
     * Returns whether two consecutive legs is eligible for the inter-modal transfer discounts
     * or if the Opal Trip Advantage (intra-modal transfer discount) applies
     *
     * @remarks
     * Assumes arrival time is tap off time and departure time is tap on time
     *
     * @param network - The Opal Network config to use
     * @param prevLeg - The previous leg
     * @param currLeg - The current leg
     * @returns true if eligible for discount
     *
     */
    static isEligibleForTransferDiscount(network: OpalNetwork, prevLeg: EfaRapidJsonLegPartial, currLeg: EfaRapidJsonLegPartial){
        const prevArrivalTime = new Date(prevLeg.destination.arrivalTimeEstimated ?? prevLeg.destination.arrivalTimePlanned).valueOf();
        const currDepartureTime = new Date(currLeg.origin.departureTimeEstimated ?? currLeg.origin.departureTimePlanned).valueOf();

        const prevArrivalOpalYmd = OpalFareCalculator.getOpalDate(network, new Date(prevArrivalTime)).date; // opal day starts at 4am
        const currArrivalOpalYmd = OpalFareCalculator.getOpalDate(network, new Date(currDepartureTime)).date; // opal day starts at 4am

        return (
            // transfer period is max 1 hour
            // TODO: implement CQ-Manly exception
            (currDepartureTime - prevArrivalTime) < 60*60*1000
        ) && (
            // first tap on new Opal day is always start of new journey
            prevArrivalOpalYmd === currArrivalOpalYmd
        );
    }

    static getTsnForStop(stop: EfaRapidJsonStopPartial) {
        if(stop.type === 'stop' && stop.isGlobalId) return stop.id;
        if(stop.parent?.type === 'stop' && stop.parent?.isGlobalId) return stop.parent.id;
        if(stop.parent?.parent?.type === 'stop' && stop.parent?.parent?.isGlobalId) return stop.parent.parent.id;

        return "-1"
    }

    static getCoordForStop(stop: EfaRapidJsonStopPartial) {
        if(stop.type === 'platform' && stop.isGlobalId) return stop.coord;
        if(stop.parent?.type === 'platform' && stop.parent?.isGlobalId) return stop.parent.coord;
        if(stop.parent?.parent?.type === 'platform' && stop.parent?.parent?.isGlobalId) return stop.parent.parent.coord;

        return stop.coord
    }

    static getIsTapOnPeak(network: OpalNetwork, tapOnTime: Date, tsn: string, mode: string) {
        const zonedTime = DateTime.fromJSDate(tapOnTime, { zone: network.CONFIG.TZ });
        const opalFareDate = OpalFareCalculator.getOpalDate(network, tapOnTime);

        const isOffPeakDayOfWeek = network.CONFIG.WEEKEND_FARE_DOW.includes(opalFareDate.dow);
        const isPublicHoliday = network.TOU.PUBLIC_HOLIDAYS.includes(opalFareDate.date);

        if(isOffPeakDayOfWeek || isPublicHoliday) return false;

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

    static getTapsForLeg(network: OpalNetwork, prevLeg: EfaRapidJsonLegPartial|null|undefined, currLeg: EfaRapidJsonLegPartial) {
        const prevLegKey = !prevLeg ? null : OpalFareCalculator.getOpalModeOfTransportForLeg(prevLeg);
        const currLegKey = OpalFareCalculator.getOpalModeOfTransportForLeg(currLeg);

        const isTransfer = (prevLeg && prevLegKey !== 'NON_OPAL' && OpalFareCalculator.isEligibleForTransferDiscount(network, prevLeg, currLeg));
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

        const isPeakTapOn = OpalFareCalculator.isLegStocktonFerry(currLeg) || OpalFareCalculator.getIsTapOnPeak(
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
                isPeakTapOn
            },
            off: {
                transactionType: OpalFareTransactionType.TAP_OFF_DISTANCE_BASED,
                tsn: destinationTsn,
                mode: currLegKey,
                time: tapOffTime,
                isTapOn: false
            }
        } as {on: OpalFareTap, off: OpalFareTap}
    }

    addLeg(leg: EfaRapidJsonLegPartial){
        const network = OpalFareCalculator.getNetworkForTime(new Date(leg.origin.departureTimeEstimated ?? leg.origin.departureTimePlanned));

        this.allLegs.push(leg);

        const prevLeg = this.legs[this.legs.length-1];
        const taps = OpalFareCalculator.getTapsForLeg(network, prevLeg, leg);

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
                const coords = currentIntramodalJourneySegmentGroup.legs.flatMap(leg => [
                    OpalFareCalculator.getCoordForStop(leg.origin),
                    OpalFareCalculator.getCoordForStop(leg.destination)
                ]);

                for(let i = 0; i < coords.length; i++){
                    for(let j = 0; j < coords.length; j++){
                        if(i === j) continue;

                        const origin = coords[i].concat().reverse();
                        const destination = coords[j].concat().reverse();

                        const pairDistance = distance(origin, destination, {units: 'kilometers'});
                        if(fareDistance == null || pairDistance > fareDistance){
                            fareDistance = pairDistance;
                        }
                    }    
                }
            }

            // TODO: throw an error
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

            const fouDiscountCents = 0; // TODO
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

            // FIXME: station access fee needs to be calculated independently
            // there may be edge cases where below will adjust SAF

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
            const dailyCap = OpalFareCalculator.getDailyCap(network, fareType, taps.on);
            const totalFareTodayPriorToCurrentLeg = this.intramodalJourneySegmentGroups.filter(group => {
                return group.date === currentIntramodalJourneySegmentGroup.date
            }).reduce((prevValue, group) => prevValue + group.fares[fareType].reduce((prevValue, fare) => prevValue + fare.totalAdditionalFareCents, 0), 0);
            const totalFareToday = totalFareTodayPriorToCurrentLeg + fare.totalAdditionalFareCents;
            if(totalFareToday > dailyCap.amount){
                const correction = -(totalFareToday-dailyCap.amount);
                fare.components.dailyCapDiscountCents += correction;
                fare.totalAdditionalFareCents += correction;
            }

            fare.totalFareCents = (fare.totalAdditionalFareCents + totalFareForIntermodalJourneySegmentGroup);
            fare.totalSafCents = (fare.totalAdditionalSafCents + totalSafForIntermodalJourneySegmentGroup);

            currentIntramodalJourneySegmentGroup.fares[fareType].push(fare);

            this.legFares[fareType].push(fare);
        }
    }

    toObject(){
        return {
            fares: this.legFares,
            // totalFare: (this.legFares['ADULT'] ?? []).reduce((pv, fare) => pv + fare.totalAdditionalFareCents, 0)
        }
    }

    toEfaFareObject(){
        const createFareObject = (fare: OpalFareComponent, jsGroup: OpalIntramodalJourneySegmentGroup) => {
            const dollarString = ((fare.totalAdditionalFareCents/100) + fare.totalAdditionalSafCents/100).toFixed(2);
            const safDollarString = (fare.totalAdditionalSafCents/100).toFixed(2);
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
            (cloned.properties as any).evaluationTicket = "nswFareEnabled";
            cloned.priceBrutto = Number(fares.reduce((pv, fare) => pv + Number(fare.priceBrutto), 0).toFixed(2));
            cloned.properties.priceTotalFare = fares.reduce((pv, fare) => pv + Number(fare.properties.priceTotalFare), 0).toFixed(2);
            cloned.properties.priceStationAccessFee = fares.reduce((pv, fare) => pv + Number(fare.properties.priceStationAccessFee), 0).toFixed(2);
            return cloned;
        });

        return faresByLeg.concat(evaluationTicketByTicket);
    }
}