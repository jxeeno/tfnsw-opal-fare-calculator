# Opal Fare Calculator

Transport for NSW indicated that fare calculations will [not be provided](https://opendataforum.transport.nsw.gov.au/t/opal-fares-on-trip-planner-api-to-be-removed-16-october-2023/3534) through the existing API from 16th October 2023 onwards.  This is a middleware application which can be deployed to Cloudflare Workers which will re-inject fare calculations back into TfNSW Trip Planner API responses.

The [fare rules, fare tables and fare distances](https://opendata.transport.nsw.gov.au/dataset/opal-fares) used for this calculator are as described and published here.

Please note that this is **not** supported by Transport for NSW and is a community-maintained solution. It is intended to be a drop-in replacement to ensure existing applications continue to work and is to be used in conjunction with the TfNSW [Trip Planner API](https://opendata.transport.nsw.gov.au/dataset/trip-planner-apis).

## Disclaimer

Fares calculated by this implementation is a best estimate based on available information.  We cannot guarantee it is correct and free of errors.  You are welcome to report issues and submit pull requests to resolve any bugs you may find.

# Usage

## Use the hosted version

We are temporarily providing a free, hosted version until the end of the 2023 to assist third-party consumers with the migration.  However, there are no guarentees of uptime, availability or accuracy of this service and the service may be withdrawn at any time.

Your existing API calls to `https://api.transport.nsw.gov.au/v1/tp/trip` can be mapped to `https://tpapi-opal-fare-calc.anytrip.com.au/v1/tp/trip`. You must continue to pass the `Authorization` header with your [TfNSW Open Data](https://opendata.transport.nsw.gov.au/) API Key.  We will not log your API Key (you'll just have take our word for it), or if you are concerned, you may host your own.

Your API request must include `outputFormat=rapidJSON` and `coordOutputFormat=EPSG:4326` for the calculator to work.  This is because other output formats (e.g. XML) is not supported by this middleware and there is currently no projection data in the middleware to allow for converting stop coordinate data to WGS84.

## Deploy to Cloudflare Workers

```bash
npm i
npm run deploy
```

You will need to update `wrangler.toml` to use your own domain name (or remove routes to use the default workers domain).

Learn more about using the Cloudflare [Wrangler CLI](https://developers.cloudflare.com/workers/get-started/guide/) here

# Generate reference data

Reference data needs to be retrieved or transformed into the network file to calculate fares.  This includes data like distance matrices, public holiday data and fare tables. You can run generate the network data by running these commands:

```bash
cd reference-data-generator
npm i
node index.js
```

# Implmentation

## Known bugs, to be resolved

- [ ] Opal-enabled temporary bus services which replace rail or ferry services are returning bus fares
- [ ] Light rail is not currently using distance matrix
- [x] Station Access Fees are not available yet
- [x] Daily caps are not available yet
- [x] Implement other fares types (other than Adult and Child)

## Outstanding tasks
- [ ] Maximum journey times and transfer limits are not implemented
- [ ] To verify behaviour for school bus services against Trip Planner API
- [ ] Implement a test suite

## Known limitations (also present in existing Trip Planner API)

* CTP nuances are not implemented, but fares in the context of a journey plan estimate are expected to be the same as Adult Opal
* Always assumes customer taps on at departure time and taps off at arrival time
* Assumes customer does not tap off and tap on again for consecutive rail legs where the wait time is less than 1 hour.  OSIs - out of station interchanges - are not possible.
* Same wharf interchanges at Circular Quay assumes customer will tap off and on again
* Specific behaviour for F1 ferry services relating to maximum journey times and transfer times
* Handling rail stations where there is no TSN or which are served by coach
* Fares not calculated for NSW TrainLink booked services
* FOU is not implemented - not relevant in journey plan fare estimate and not available after 19th October
* Fare calculations assume all trips of the journeys occur within the same Opal day. Fare rules specific to services spanning across multiple Opal days or weeks are not applied.
* Distance-based fares without a distance mapping table (i.e. bus services) use approximate distances which may not be the same as the distances used for calculating actual Opal fares. This can be due to variations in coordinates between systems and map projection. This may impact a small number of bus stop combinations where the distance is close to the edge of the bands.

## Implemented rules

* Rail and ferry distances from mapping table
* Peak, off-peak fares including variying peak times for intercity stations
* Public holidays and Friday/Saturday/Sunday fares
* Stockton Ferry fares are peak bus fares
* Intra-modal transfer discount aka "Opal Trip Advantage"
* Partial peak services during an intra-modal transfer
* Longest fare distance rule for non-rail intra-modal transfers
* Highest fare band rule for intra-modal transfers
* Inter-modal transfer discount
* Station access fee
* Daily caps