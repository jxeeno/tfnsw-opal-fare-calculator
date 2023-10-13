const {default: axios} = require("axios");
const fs = require("fs");

const API_KEY = process.env.API_KEY;

const SPECIFIC_COMBINATIONS = [
    ["213510", "213110", 'TRACKWORK_BUS_NO_OPAL', {itdDate: "20231013", itdTime: "2205"}]
]

// a list of TSNs to generate snapshots against
const CANDIDATE_TSNS = [
    // Ferry wharfs
    "209573", // Manly Wharf
    "200020", // Circular Quay
    "2000441", // Barangaroo Wharf 2
    "21271", // Olympic Park Wharf
    "2300146", // Queens Wharf (Stockton Ferry)
    "229574", // Stockton Wharf (Stockton Ferry)

    // Airport stations to verify SAF
    "201710", // Green Square Station
    "202010", // Mascot Station
    "202020", // Domestic Airport Station
    "202030", // International Airport Station
    "220510", // Wolli Creek Station

    // Metro stations
    "2155384", // Tallawong Station

    // Intercity trains
    "230430", // Sandgate Station
    "229310", // Newcastle Interchange Station
    "279538", // Bathurst Station
    "279010", // Lithgow Station
    "257610", // Bowral Station
    "253330", // Kiama Station
    "254110", // Bomaderry Station

    // Bus
    "210323", // Mona Vale B-Line
    "2164331", // Victoria T-Way
    
    // Light Rail
    "200947", // The Star LR
    "203361", // Kensington LR
    "2300135", // Queens Wharf LR
]

// a list of date times to test against
const TIMES = {
    NEAR_END_OF_OPAL_DAY: {itdTime: '0330', itdDate: '20231013'},
    // WEEKDAY_METRO_PRE_AM_PEAK: {itdTime: '0500', itdDate: '20231012'},
    // WEEKDAY_OUTER_METRO_PRE_AM_PEAK: {itdTime: '0630', itdDate: '20231012'},
};

async function main() {
    const queryAndSave = async (origin, destination, timeKey, timeParams) => {
        const combinationKey = `${origin}_${destination}_${timeKey}`;
        const pathName = `../snapshots/${combinationKey}.json`;
        if(!fs.existsSync(pathName)){
            const {data} = await axios.get('https://api.transport.nsw.gov.au/v1/tp/trip', {
                params: {
                    outputFormat: "rapidJSON",
                    coordOutputFormat: "EPSG:4326",
                    depArrMacro: "dep",
                    type_origin: "any",
                    name_origin: origin,
                    type_destination: "any",
                    name_destination: destination,
                    calcNumberOfTrips: "6",
                    TfNSWTR: "true",
                    ...timeParams
                },
                headers: {
                    Authorization: `apikey ${API_KEY}`
                }
            });

            fs.writeFileSync(pathName, JSON.stringify(data));
            console.log(pathName);
        }
    }
    // const combinations = [];
    for(const [origin, destination, timeKey, timeParams] of SPECIFIC_COMBINATIONS){
        await queryAndSave(origin, destination, timeKey, timeParams)
    }
    for(const origin of CANDIDATE_TSNS){
        for(const destination of CANDIDATE_TSNS){
            if(origin !== destination){
                // combinations.push(`${origin}->${destination}`);
                for(const timeKey in TIMES){
                    const timeParams = TIMES[timeKey];
                    
                    await queryAndSave(origin, destination, timeKey, timeParams)
                }
            }
        }    
    }
}

main();

// console.log(combinations.length)