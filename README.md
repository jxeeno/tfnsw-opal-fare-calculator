# Opal Fare Calculator

Transport for NSW indicated that fare calculations will not be provided through the existing API from 19th October 2023 onwards.  This is a middleware application which can be deployed to Cloudflare Workers which will re-inject fare calculations into TfNSW Trip Planner API responses.

It is intended to be a drop-in replacement to ensure existing applications continue to work.

## Disclaimer

Fares calculated by this implementation is a best estimate based on available information.  We cannot guarantee it is correct and free of errors.  You are welcome to report issues and submit pull requests to resolve any bugs you may find.

# Implmentation

## Known bugs, to be resolved

- [ ] Opal-enabled temporary bus services which replace rail or ferry services are returning bus fares
- [ ] Light rail is not currently using distance matrix
- [x] Station Access Fees are not available yet
- [ ] Daily and weekly caps are not available yet
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