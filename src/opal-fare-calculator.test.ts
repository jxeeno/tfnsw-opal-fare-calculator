import { unstable_dev } from 'wrangler';
import type { UnstableDevWorker } from 'wrangler';
import { vi, describe, expect, it, beforeAll, afterAll } from 'vitest';
import createFetchMock from 'vitest-fetch-mock';
import { OpalFareCalculator } from './opal-fare-calculator';


const excluded = [
	// Trip Planner API incorrectly including regional train within transfer window
	'209573_229574_WEEKDAY_METRO_PRE_AM_PEAK::6',
	'209573_229574_WEEKDAY_METRO_PRE_AM_PEAK::7'
]

const testSnapshot = (fname: string) => {

	it(`should calculate correct fares for ${fname}`, async () => {
		const mockedResponse = (await import(`./tests/snapshots/${fname}.json`)) as any;
		for(let i = 0; i < mockedResponse.journeys.length-1; i++){
			const journey = mockedResponse.journeys[i];
			const journeyId = `${fname}::${i}`;

			if((excluded).includes(journeyId)) continue;
			
			const calculator = new OpalFareCalculator();
			let hasRegional = false;
			for(const leg of journey.legs){
				calculator.addLeg(leg as any);

				//
				// NOTE: there is a bug in the Trip Planner API implementation of inter-modal transfer
				// In this scenario:
				// Opal train -> Regional train -> Bus
				// 
				// The TP implementation will use the arrival time of regional train and
				// departure time of bus to determine if a inter-modal transfer is available
				// 
				// However, since Regional train is not an Opal service, in reality, the
				// customer will tap off on the Opal train and rejoin the Opal network when
				// boarding the bus.
				//
				if(leg.transportation.product.name === 'Regional Trains and Coaches Network'){
					hasRegional = true;
				}
			}

			if(hasRegional) continue

			const tickets = calculator.toEfaFareObject();
			const fareInternals = calculator.toObject();
			const fareTypes = [...new Set(tickets.map(ticket => ticket.person))];
			for(const fareType of fareTypes){
				const calculatedFare = tickets.find(ticket => ticket.person === fareType && ticket.properties.evaluationTicket);
				const efaTickets = journey.fare.tickets.filter((ticket: any) => ticket.person === fareType && !ticket.properties.evaluationTicket);
				const efaFare = journey.fare.tickets.find((ticket: any) => ticket.person === fareType && ticket.properties.evaluationTicket);
				// console.log(calculatedFare)
				// console.log(efaFare)
				// console.log(fareInternals.fares[fareType])
				// console.log(efaTickets);
				expect.soft(calculatedFare?.properties.priceTotalFare, `${journeyId} priceTotalFare: ${fareType}`).toBe(efaFare?.properties.priceTotalFare)
				expect.soft(calculatedFare?.properties.priceStationAccessFee, `${journeyId} priceStationAccessFee: ${fareType}`).toBe(efaFare?.properties.priceStationAccessFee)
				expect.soft(calculatedFare?.priceBrutto, `${journeyId} priceBrutto: ${fareType}`).toBe(efaFare?.priceBrutto)
			}
		}
	});
}

describe('OpalFareCalculator', () => {
	testSnapshot('200020_2000441_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('200020_2000441_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('200020_200947_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('200020_200947_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('200020_201710_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('200020_201710_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('200020_202010_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('200020_202010_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('200020_202020_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('200020_202020_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('200020_202030_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('200020_202030_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('200020_203361_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('200020_203361_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('200020_209573_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('200020_209573_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('200020_210323_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('200020_210323_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('200020_21271_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('200020_21271_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('200020_2155384_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('200020_2155384_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('200020_2164331_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('200020_2164331_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('200020_220510_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('200020_220510_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('200020_229310_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('200020_229310_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('200020_229574_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('200020_229574_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('200020_2300135_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('200020_2300135_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('200020_2300146_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('200020_2300146_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('200020_230430_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('200020_230430_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('200020_253330_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('200020_253330_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('200020_254110_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('200020_254110_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('200020_257610_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('200020_257610_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('200020_279010_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('200020_279010_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('200020_279538_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('200020_279538_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('2000441_200020_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('2000441_200020_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('2000441_209573_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('2000441_209573_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('2000441_21271_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('2000441_21271_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('2000441_2300146_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('2000441_2300146_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('209573_200020_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('209573_200020_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('209573_2000441_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('209573_2000441_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('209573_200947_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('209573_200947_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('209573_201710_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('209573_201710_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('209573_202010_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('209573_202010_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('209573_202020_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('209573_202020_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('209573_202030_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('209573_202030_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('209573_203361_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('209573_203361_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('209573_210323_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('209573_210323_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('209573_21271_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('209573_21271_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('209573_2155384_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('209573_2155384_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('209573_2164331_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('209573_2164331_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('209573_220510_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('209573_220510_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('209573_229310_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('209573_229310_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('209573_229574_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('209573_229574_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('209573_2300135_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('209573_2300135_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('209573_2300146_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('209573_2300146_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('209573_230430_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('209573_230430_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('209573_253330_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('209573_253330_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('209573_254110_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('209573_254110_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('209573_257610_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('209573_257610_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('209573_279010_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('209573_279010_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
	testSnapshot('209573_279538_WEEKDAY_METRO_PRE_AM_PEAK')
	testSnapshot('209573_279538_WEEKDAY_OUTER_METRO_PRE_AM_PEAK')
});