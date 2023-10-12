export type EfaRapidJsonStopPartial = {
    id: string,
    parent?: EfaRapidJsonStopPartial,
    type: string,
    coord: [number, number]
    isGlobalId: boolean;
    departureTimePlanned: string,
    departureTimeEstimated?: string,
    arrivalTimePlanned: string,
    arrivalTimeEstimated?: string,
}

export type EfaRapidJsonLegPartial = {
    duration: number,
    origin: EfaRapidJsonStopPartial,
    destination: EfaRapidJsonStopPartial,
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
        legs: EfaRapidJsonLegPartial[],
        fare?: {
            tickets?: any[]
        }
    }>
}
