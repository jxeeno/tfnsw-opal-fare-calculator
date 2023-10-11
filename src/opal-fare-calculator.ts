import REF_RAIL_DISTANCE from "./ref_rail_distance.json";
import REF_FERRY_DISTANCE from "./ref_ferry_distance.json";
import REF_PEAK_HOURS from "./ref_peak_hours.json";
import REF_PUBLIC_HOLIDAYS from "./ref_public_holidays.json";
import REF_OUTER_METRO_STATIONS from "./ref_outer_metro_stations.json";
import REF_STOCKTON_FERRY_TSN from "./ref_stockton_ferry_tsn.json";
import REF_FARE_TABLE from "./ref_fare_table.json";

import { DateTime } from 'luxon';
import distance from "@turf/distance";
import { EfaRapidJsonLegPartial, EfaRapidJsonStopPartial, OpalFareComponent, OpalFareTap, OpalFareTransactionType, OpalIntramodalJourneySegmentGroup } from "./efa.types";

export class OpalFareCalculator {
    constructor(){}

    taps: OpalFareTap[] = [];
    legFares: OpalFareComponent[] = [];
    legs: EfaRapidJsonLegPartial[] = [];
    allLegs: EfaRapidJsonLegPartial[] = [];
    intramodalJourneySegmentGroups: OpalIntramodalJourneySegmentGroup[] = [];


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

    static getFareDistance(mode: string, origin: EfaRapidJsonStopPartial, destination: EfaRapidJsonStopPartial){
        const originTsn = OpalFareCalculator.getTsnForStop(origin);
        const destinationTsn = OpalFareCalculator.getTsnForStop(destination);
        const odKey = `${originTsn}:${destinationTsn}`;
        if(mode === "RAIL"){
            return (REF_RAIL_DISTANCE as {[k: string]: number})[odKey] ?? null;
        }else if(mode === "FERRY"){
            return (REF_FERRY_DISTANCE as {[k: string]: number})[odKey] ?? null;
        }
    }

    static getBaseFare(type: string, mode: string, distance: number|undefined, isPeak: boolean, isFou: boolean) {
        if(distance == null) return;

        const fareTable = (REF_FARE_TABLE as any);
        if(!fareTable[type]) throw new Error(`Fare type ${type} could not be found`);
        
        const modeFares = fareTable[type].MODES[mode];
        if(!modeFares) return;

        const fareKey = (isFou ? 'FOU_' : '') + (isPeak ? 'PEAK' : 'OFFPEAK');

        for(const band in modeFares){
            if(distance >= modeFares[band].FROM_KM && distance < modeFares[band].TO_KM){
                return modeFares[band][fareKey]
            }
        }
    }

    static getFareParameters(type: string) {
        const fareTable = (REF_FARE_TABLE as any);
        if(!fareTable[type]) throw new Error(`Fare type ${type} could not be found`);
        
        return fareTable[type] as {
            NAME: string,
            CAPS: {
                DAILY_CAP: number,
                WEEKLY_CAP: number
            },
            INTERMODAL_DISCOUNT: number
        };
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
     * @param prevLeg - The previous leg
     * @param currLeg - The current leg
     * @returns true if eligible for discount
     *
     */
    static isEligibleForTransferDiscount(prevLeg: EfaRapidJsonLegPartial, currLeg: EfaRapidJsonLegPartial){
        const prevArrivalTime = new Date(prevLeg.destination.arrivalTimeEstimated ?? prevLeg.destination.arrivalTimePlanned).valueOf();
        const currDepartureTime = new Date(currLeg.origin.departureTimeEstimated ?? currLeg.origin.departureTimePlanned).valueOf();
        return (currDepartureTime - prevArrivalTime) < 60*60*1000;
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

    static getIsTapOnPeak(tapOnTime: Date, tsn: string, mode: string) {
        const zonedTime = DateTime.fromJSDate(tapOnTime, { zone: "Australia/Sydney" });
        const ymd = zonedTime.toFormat("yyyyMMdd");

        const isOffPeakDayOfWeek = [5, 6, 7].includes(zonedTime.weekday);
        const isPublicHoliday = REF_PUBLIC_HOLIDAYS.includes(ymd);

        if(isOffPeakDayOfWeek || isPublicHoliday) return false;

        let periods;
        if(mode === 'RAIL'){
            if(REF_OUTER_METRO_STATIONS.includes(tsn)){
                // outer metro
                periods = REF_PEAK_HOURS.OUTER_METRO_PEAK
            }else{
                // metro
                periods = REF_PEAK_HOURS.METRO_PEAK
            }
        }else{
            // non rail and non ferry
            periods = REF_PEAK_HOURS.METRO_PEAK
        }

        const timeOffset = zonedTime.hour * 60 + zonedTime.minute;
        const isWithinRange = (timeOffset: number, range: number[]) => {
            return timeOffset >= range[0] && timeOffset < range[1]
        }

        return (isWithinRange(timeOffset, periods.AM_PEAK) || isWithinRange(timeOffset, periods.PM_PEAK));
    }

    static getTapsForLeg(prevLeg: EfaRapidJsonLegPartial|null|undefined, currLeg: EfaRapidJsonLegPartial) {
        const prevLegKey = !prevLeg ? null : OpalFareCalculator.getOpalModeOfTransportForLeg(prevLeg);
        const currLegKey = OpalFareCalculator.getOpalModeOfTransportForLeg(currLeg);

        const isTransfer = (prevLeg && prevLegKey !== 'NON_OPAL' && OpalFareCalculator.isEligibleForTransferDiscount(prevLeg, currLeg));
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
            tapOnTime, originTsn, currLegKey
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
        this.allLegs.push(leg);

        const prevLeg = this.legs[this.legs.length-1];
        const taps = OpalFareCalculator.getTapsForLeg(prevLeg, leg);

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
                fares: [],
                mode: taps.on.mode
            };
            this.intramodalJourneySegmentGroups.push(currentIntramodalJourneySegmentGroup);
        }

        currentIntramodalJourneySegmentGroup.legs.push(leg);
        currentIntramodalJourneySegmentGroup.taps.push(taps.on, taps.off);

        // now calculate fares for current intramodal journey segments
        const fareType = "ADULT";
        const totalFareForIntermodalJourneySegmentGroup = currentIntramodalJourneySegmentGroup.fares.reduce((pv, fare) => pv + fare.totalAdditionalFareCents, 0);
        
        const intermodalDiscountCents = [
            OpalFareTransactionType.TAP_ON_INTERMODAL_TRANSFER,
            OpalFareTransactionType.TAP_ON_F1_INTERMODAL_TRANSFER
        ].includes(currentIntramodalJourneySegmentGroup.taps[0].transactionType) ? -OpalFareCalculator.getFareParameters(fareType).INTERMODAL_DISCOUNT : 0;

        let shouldLegUsePeakFare = taps.on.isPeakTapOn;
        let permitNegativeAdditionalFare = false;
        let retainHighestFareBand = true;

        // TODO: model ferry same wharf interchanges at CQ
        let fareDistance;
        if(currentIntramodalJourneySegmentGroup.mode === 'RAIL'){
            // We will assume no tap out at interchanges
            // Fare distance is first station in group to last staion in group

            const origin = currentIntramodalJourneySegmentGroup.legs[0].origin;
            const destination = currentIntramodalJourneySegmentGroup.legs[
                currentIntramodalJourneySegmentGroup.legs.length-1
            ].destination;

            fareDistance = OpalFareCalculator.getFareDistance(
                currentIntramodalJourneySegmentGroup.mode,
                origin, destination
            );

            shouldLegUsePeakFare = currentIntramodalJourneySegmentGroup.taps.some(tap => tap.isPeakTapOn);
            permitNegativeAdditionalFare = true;
            retainHighestFareBand = false;
        }else{
            // use the longest distance between any two stops
            const coords = currentIntramodalJourneySegmentGroup.legs.flatMap(leg => [OpalFareCalculator.getCoordForStop(leg.origin), OpalFareCalculator.getCoordForStop(leg.destination)]);
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


        const baseFareCents = OpalFareCalculator.getBaseFare(
            fareType,
            currentIntramodalJourneySegmentGroup.mode,
            fareDistance,
            true,
            false
        );

        const baseFareCentsCurrentContext = OpalFareCalculator.getBaseFare(
            fareType,
            currentIntramodalJourneySegmentGroup.mode,
            fareDistance,
            shouldLegUsePeakFare,
            false
        );

        const dailyCapDiscountCents = 0; // TODO
        const offPeakDiscountCents = baseFareCentsCurrentContext - baseFareCents;

        const fouDiscountCents = 0; // TODO
        const stationAccessFeeCents = 0; // TODO
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
                dailyCapDiscountCents +
                stationAccessFeeCents
            ),
            totalFareCents: 0,
            leg
        };

        if(fare.totalAdditionalFareCents < 0 && !permitNegativeAdditionalFare){
            const correction = -fare.totalAdditionalFareCents;
            fare.components.complexAdjustmentCents += correction;
            fare.totalAdditionalFareCents = 0;
        }

        const maxPreviousFare = Math.max(...currentIntramodalJourneySegmentGroup.fares.map(fare => fare.totalFareCents) ?? [0]);
        if((fare.totalAdditionalFareCents + totalFareForIntermodalJourneySegmentGroup) < maxPreviousFare && retainHighestFareBand){
            const correction = maxPreviousFare - (fare.totalAdditionalFareCents + totalFareForIntermodalJourneySegmentGroup);
            fare.components.complexAdjustmentCents += correction;
            fare.totalAdditionalFareCents += correction;
        }

        fare.totalFareCents = (fare.totalAdditionalFareCents + totalFareForIntermodalJourneySegmentGroup);

        currentIntramodalJourneySegmentGroup.fares.push(fare);
        this.legFares.push(fare);
    }

    toObject(){
        return {
            fares: this.legFares,
            totalFare: this.legFares.reduce((pv, fare) => pv + fare.totalAdditionalFareCents, 0)
        }
    }

    toEfaFareObject(){
        const createFareObject = (fare: OpalFareComponent, jsGroup: OpalIntramodalJourneySegmentGroup) => {
            const dollarString = (fare.totalAdditionalFareCents/100).toFixed(2);
            const fareName = OpalFareCalculator.getFareParameters(fare.type).NAME;
            const legIdx = this.allLegs.indexOf(fare.leg);
            return {
                "id": `ANYTRIP-EST-${fare.type}-${fare.mode}`, // "REG-BUSES-PEAK",
                "name": "Opal tariff",
                "comment": "",
                "URL": "",
                "currency": "AUD",
                "priceLevel": "0",
                "priceBrutto": Number(dollarString),
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
                "properties": {
                    "riderCategoryName": fareName,
                    "priceTotalFare": dollarString,
                    "distExact": 0,
                    "distRounded": 0,
                    "pricePerKM": 0,
                    "priceBasic": 0,
                    "tariffProductDefault": [],
                    "tariffProductOption": []
                }
            }
        }

        return this.intramodalJourneySegmentGroups.flatMap(jsGroup => jsGroup.fares.map(fare => createFareObject(fare, jsGroup)))
    }
}