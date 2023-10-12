import neatCsv from "neat-csv";
import fs from "fs";
import path from "path";
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

    fs.writeFileSync("./common/rail_distance.json", JSON.stringify(distancePairs, null, 2));
}


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

    fs.writeFileSync("./common/ferry_distance.json", JSON.stringify(distancePairs, null, 2));
}

const getPublicHolidays = async () => {
    // data

    const {data} = await axios.get("https://data.gov.au/data/api/3/action/datastore_search_sql", {
        params: {
            sql: "SELECT \"Date\" from \"33673aca-0857-42e5-b8f0-9981b4755686\" WHERE \"Jurisdiction\" = 'nsw'"
        }
    });

    fs.writeFileSync("./common/public_holidays.json", JSON.stringify(data.result.records.map(record => record.Date), null, 2));
    
}




const generateNetworkData = () => {
    const folders = ['2022-fares', '2023-fares'];
    const network = [];
    for(const folder of folders){
        network.push({
            CONFIG: JSON.parse(fs.readFileSync(path.join(folder, 'config.json'))),
            FARE_TABLE: JSON.parse(fs.readFileSync(path.join(folder, 'fare_table.json'))),
            SAF_TSN: JSON.parse(fs.readFileSync(path.join(folder, 'saf_tsn.json'))),
            DISTANCE_MATRIX: {
                FERRY: JSON.parse(fs.readFileSync(path.join('common', 'ferry_distance.json'))),
                RAIL: JSON.parse(fs.readFileSync(path.join('common', 'rail_distance.json'))),
            },
            TOU: {
                PEAK_HOURS: JSON.parse(fs.readFileSync(path.join(folder, 'peak_hours.json'))),
                PUBLIC_HOLIDAYS: JSON.parse(fs.readFileSync(path.join('common', 'public_holidays.json'))),
                OUTER_METRO_STATIONS: JSON.parse(fs.readFileSync(path.join(folder, 'outer_metro_stations.json'))),
            }
        })
    }

    fs.writeFileSync('../src/ref/networks.json', JSON.stringify(network, null, 2));
}

(async () => {
    await convertFerryDistanceCsv();
    await convertFerryDistanceCsv();
    await convertRailDistanceCsv();
    await getPublicHolidays();
    await generateNetworkData();
})();