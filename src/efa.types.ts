export type EfaRapidJsonStopPartial = {
	id: string,
	parent?: EfaRapidJsonStopPartial,
	type: string,
	coord: [number, number]
	isGlobalId: boolean;
}

export type EfaRapidJsonLegPartial = {
	origin: EfaRapidJsonStopPartial,
	destination: EfaRapidJsonStopPartial,
	departureTimePlanned: string,
	departureTimeEstimated?: string,
	arrivalTimePlanned: string,
	arrivalTimeEstimated?: string,
	transportation: {
		id: string,
		number: string,
		disassembledName: string,
		iconId: number,
		product: {
			class: number,
			name: string,
			iconId: number
		},
		operator: {
			id: string,
			name: string
		},
	}
}

export type EfaRapidJsonTripPartial = {
	journeys: Array<{
		legs: EfaRapidJsonLegPartial[]
	}>
}

export enum OpalFareTransactionType {
    ISSUE_NEW_CARD, // unused
    TAP_ON_NEW_JOURNEY,
    TAP_ON_INTRAMODAL_TRANSFER, // same mode
    TAP_ON_INTERMODAL_TRANSFER, // different mode
    
    // F1 ferry taps aren't used for this implementation
    TAP_ON_F1_NEW_JOURNEY,
    TAP_ON_F1_INTRAMODAL_TRANSFER,
    TAP_ON_F1_INTERMODAL_TRANSFER,

    TAP_OFF_DISTANCE_BASED,
    TAP_OFF_FLAT_RATE, // unused
    TAP_OFF_DEFAULT_NO_TAP_OFF, // unused
    TAP_OFF_DEFAULT_NO_TAP_ON, // unused

    TAP_ON_REVERSAL, // unused
}

export type OpalFareTap = {
    transactionType: OpalFareTransactionType;
    tsn: string;
    nlc?: string; // unused

    time: Date;

    mode: string;
    isTapOn: boolean;
    isPeakTapOn: boolean;
}

export type OpalFareComponent = {
    type: string;
    taps: {
        on: OpalFareTap,
        off: OpalFareTap
    };
    mode: string;
    distance: number;

    components: {
        baseFareCents: number;
        fouDiscountCents: number;        
        intramodalDiscountCents: number;
        offPeakDiscountCents: number;
        intermodalDiscountCents: number;
        dailyCapDiscountCents: number;
        stationAccessFeeCents: number;
    };

    totalAdditionalFareCents: number;

    leg?: EfaRapidJsonLegPartial;
}

export type OpalIntramodalJourneySegmentGroup = {
    legs: EfaRapidJsonLegPartial[];
    taps: OpalFareTap[];
    fares: OpalFareComponent[];

    mode: string;
    maximumDistance?: number;
    hasPeakTapOn?: boolean;
}