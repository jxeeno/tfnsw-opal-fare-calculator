import { EfaRapidJsonTripPartial } from "./efa.types";
import { OpalFareCalculator } from "./opal-fare-calculator";

export interface Env {}

export default {
	async fetch(
		request: Request	
	): Promise<Response> {
		const url = new URL(request.url);

		const anytripFareDebug = url.searchParams.has('anytripFareDebug');

		const auth = request.headers.get('authorization')

		const _resp = await fetch("https://api.transport.nsw.gov.au/v1/tp/trip?" + url.searchParams.toString(), {
			headers: auth ? {
				"authorization": auth
			} : {}
		});

		if(!(_resp.headers.get('content-type') ?? '').includes("application/json")){
			return _resp;
		}

		const resp = await _resp.json() as EfaRapidJsonTripPartial;

		if(resp.journeys && url.searchParams.get('outputFormat') === 'rapidJSON' && url.searchParams.get('coordOutputFormat') === 'EPSG:4326'){
			// can do calculations

			const debugJourneys = [];

			for(const journey of resp.journeys){
				const calculator = new OpalFareCalculator();
				for(const leg of journey.legs){
					calculator.addLeg(leg);
				}
	
				const tickets = calculator.toEfaFareObject();
				const fareTypes = Object.keys(calculator.toObject().fares);

				const fareDebug = Object.fromEntries(fareTypes.map(fareType => [
					fareType, {
						efaTotalFare: journey.fare?.tickets?.filter((ticket: any) => ticket.person === fareType && ticket.properties.evaluationTicket).reduce((pv: number, ticket: any) => pv + Number(ticket.properties.priceTotalFare), 0).toFixed(2),
						anytripTotalFare: tickets.filter((ticket: any) => ticket.person === fareType).reduce((pv: number, ticket: any) => pv + Number(ticket.properties.priceTotalFare), 0).toFixed(2)
					}
				]))

				debugJourneys.push(fareDebug)
	
				Object.assign(journey, {
					fares: {
						tickets
					}
				});
			}

			if(anytripFareDebug){
				(resp as any).journeys = undefined;
				(resp as any).debugJourneys = debugJourneys;
			}
		}

		return Response.json(resp);
	},
};
