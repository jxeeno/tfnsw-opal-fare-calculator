import { EfaRapidJsonTripPartial } from "./efa.types";
import { OpalFareCalculator } from "./opal-fare-calculator";

export interface Env {}

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext	
	): Promise<Response> {
		const url = new URL(request.url);

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

			for(const journey of resp.journeys){
				const calculator = new OpalFareCalculator();
				for(const leg of journey.legs){
					calculator.addLeg(leg);
				}
	
				const efaFares = journey.fare?.tickets?.filter((ticket: any) => ticket.person === "ADULT" && !ticket.properties.evaluationTicket) ?? [];
	
				Object.assign(journey, {
					anytripFare: calculator.toEfaFareObject()
				}, {
					efaFares,
					// efaTotalFare: efaFares.filter((ticket: any) => ticket.properties.evaluationTicket).reduce((pv: number, ticket: any) => pv + ticket.priceBrutto, 0)
				});
			}
		}

		return Response.json(resp);
	},
};
