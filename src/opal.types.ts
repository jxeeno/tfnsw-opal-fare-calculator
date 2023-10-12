import { EfaRapidJsonLegPartial } from "./efa.types";

export type OpalNetwork = {
    CONFIG: {
        VALID_FROM: string;
        VALID_TO: string;
        TZ: string;
        WEEKEND_FARE_DOW: number[]
    },
    FARE_TABLE: {
        [k: string]: {
            NAME: string;
            CAPS: {
                DAILY_CAP: number;
                WEEKEND_DAILY_CAP: number;
                WEEKLY_CAP: number;
            };
            INTERMODAL_DISCOUNT: number;
            SAF: {
                NON_ALC_RATE: number;
                ALC_RATES: {
                    [k: string]: number
                }
            },
            MODES: {
                [k: string]: {
                    [k: string]: {
                        PEAK: number,
                        OFFPEAK: number,
                        FOU_PEAK: number,
                        FOU_OFFPEAK: number,
                        FROM_KM: number,
                        TO_KM: number
                    }
                }
            }
        }
    },
    SAF_TSN: string[],
    DISTANCE_MATRIX: {
        [k: string]: {
            [k: string]: number
        }
    },
    TOU: {
        PEAK_HOURS: {
            METRO_PEAK: {
                AM_PEAK: [number, number],
                PM_PEAK: [number, number]
            },
            OUTER_METRO_PEAK: {
                AM_PEAK: [number, number],
                PM_PEAK: [number, number]
            },
            FERRY_METRO_PEAK: {
                AM_PEAK: [number, number],
                PM_PEAK: [number, number]
            }
        },
        PUBLIC_HOLIDAYS: string[],
        OUTER_METRO_STATIONS: string[]
    }
};


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

    coords: [number, number];

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
    distance?: number;

    components: {
        baseFareCents: number;
        fouDiscountCents: number;        
        intramodalDiscountCents: number;
        offPeakDiscountCents: number;
        intermodalDiscountCents: number;
        complexAdjustmentCents: number;
        dailyCapDiscountCents: number;
        stationAccessFeeCents: number;
    };

    totalAdditionalFareCents: number;
    totalFareCents: number;

    totalAdditionalSafCents: number;
    totalSafCents: number;

    leg: EfaRapidJsonLegPartial;
}

export type OpalIntramodalJourneySegmentGroup = {
    legs: EfaRapidJsonLegPartial[];
    taps: OpalFareTap[];
    fares: {[k: string]: OpalFareComponent[]};

    mode: string;
    date: string;
    network: OpalNetwork;
    dow: number;
    maximumDistance?: number;
    hasPeakTapOn?: boolean;
}