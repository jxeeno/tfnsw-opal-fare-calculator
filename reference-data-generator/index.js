import neatCsv from "neat-csv";
import fs from "fs";
import axios from "axios";

// 
const convertRailDistanceCsv = async () => {
    const data = await neatCsv(fs.readFileSync("rail-distances.csv"), {});
    // console.log(data);

    const stationNameToTsn = new Map();
    for(const row of data){
        if(row.TSN && row['Station Name'] && row.TSN.match(/^[0-9]+$/)){
            stationNameToTsn.set(row['Station Name'], row.TSN)
        }
    }

    const distancePairs = {};
    for(const row of data){
        if(!row.TSN.match(/^[0-9]+$/)) continue;

        const originTsn = row.TSN;
        const originName = row['Station Name'];
        for(const destinationName in row){
            const destinationTsn = stationNameToTsn.get(destinationName);
            if(!destinationTsn){
                console.warn(`Could not find TSN for ${destinationName}`);
                continue;
            }

            if(destinationTsn === originTsn) continue;

            const odKey = `${originTsn}:${destinationTsn}`;
            const doKey = `${destinationTsn}:${originTsn}`;
            distancePairs[odKey] = Number(row[destinationName]);
            distancePairs[doKey] = Number(row[destinationName]);
        }
    }

    fs.writeFileSync("../src/ref_rail_distance.json", JSON.stringify(distancePairs, null, 2));
}

convertRailDistanceCsv();


// 
const convertFerryDistanceCsv = async () => {
    const data = await neatCsv(fs.readFileSync("ferry-distances.csv"), {});
    // console.log(data);

    const stationNameToTsn = new Map();
    for(const row of data){
        if(row.TSN && row['Station Name'] && row.TSN.match(/^[0-9]+$/)){
            stationNameToTsn.set(row['Station Name'], row.TSN)
        }
    }

    const distancePairs = {};
    for(const row of data){
        if(!row.TSN.match(/^[0-9]+$/)) continue;
        
        const originTsn = row.TSN;
        const originName = row['Station Name'];
        for(const destinationName in row){
            const destinationTsn = stationNameToTsn.get(destinationName);
            if(!destinationTsn){
                console.warn(`Could not find TSN for ${destinationName}`);
                continue;
            }

            if(destinationTsn === originTsn) continue;

            const odKey = `${originTsn}:${destinationTsn}`;
            const doKey = `${destinationTsn}:${originTsn}`;
            const val = Number((row[destinationName].replace(",", "")/1000).toFixed(3))
            distancePairs[odKey] = val;
            distancePairs[doKey] = val;
        }
    }

    fs.writeFileSync("../src/ref_ferry_distance.json", JSON.stringify(distancePairs, null, 2));
}

convertFerryDistanceCsv();

const getPublicHolidays = async () => {
    // data

    const {data} = await axios.get("https://data.gov.au/data/api/3/action/datastore_search_sql", {
        params: {
            sql: "SELECT \"Date\" from \"33673aca-0857-42e5-b8f0-9981b4755686\" WHERE \"Jurisdiction\" = 'nsw'"
        }
    });

    fs.writeFileSync("../src/ref_public_holidays.json", JSON.stringify(data.result.records.map(record => record.Date), null, 2));
    
}

getPublicHolidays();