import { registerBidder } from 'src/adapters/bidderFactory';
import { auctionManager } from 'src/auctionManager';
import CONSTANTS from 'src/constants.json';
import * as events from 'src/events';

const BIDDER_CODE = 'seznam';
export const spec = {
    code: BIDDER_CODE,

    isBidRequestValid: function(bid) {
        return !!(bid.params.zoneId) && window.im && im.displaySeznamAdvert();
    },

    buildRequests: function(validBidRequests) {
        const zones = validBidRequests.map((bid) => Object.assign(
            {},
            bid.params,
            { callback: () => {} }, // Fake for IM._buildItem()
        ));

        const IM = window.im;

        if (!IM.renderAd) {
            spec.registerRenderAd();
        }

        IM._logAds(zones);

        const prefix = IM._buildPrefix();
        let data = prefix;
        const url = IM.conf.protocol + "://" + IM.conf.server + "/json";

		for (let i = 0; i < zones.length; i++) {
            const str = IM._buildItem(zones[i], i);
            data += "&" + str;
        }

        return {
            method: 'POST',
            url,
            data,
            options: {
                contentType: 'application/x-www-form-urlencoded',
            },
            bids: validBidRequests,
        };
    },

    interpretResponse: function (serverResponse, bidRequest) {
        const bidResponses = [];
        const IM = window.im;

        for (let i = 0; i < serverResponse.body.length; i++) {
            const response = serverResponse.body[i];
            const bid = bidRequest.bids[i];

            // Calculate dimensions
            let width = 0;
            let height = 0;

            if (response.spots.length) {
                // Width should be max of all spots
                width = Math.max.call(Math, response.spots.map((s) => s.width));
                // Spots are inserted to the DOM one after another - so sum heights
                height = response.spots.map((s) => s.height).reduce((a, c) => a + c, 0);
            } else {
                width = 1;
                height = 1;
            }

            bidResponses.push({
                requestId: bid.bidId,
                cpm: 100,
                width,
                height,
                ad: response,
                ttl: 360,
                creativeId: 'seznam-' + bid.params.zoneId,
                netRevenue: true,
                currency: 'CZK',
            });
        }

        return bidResponses;
    },

    registerRenderAd() {
        const IM = window.im;

        IM.renderAd = function(doc, id) {
            if (!doc || !id) {
                return;
            }

            const bid = auctionManager.findBidByAdId(id);
            bid.status = 'rendered';

            // We are already in the iframe so Seznam is safe to write the AD
            // bid.ad.spots.forEach((spot) => {
            //     spot.iframe = true;
            // });

            auctionManager.addWinningBid(bid);

            // emit 'bid won' event here
            events.emit(CONSTANTS.EVENTS.BID_WON, bid);

            try {
                // Seznam magic
                window.replaceDocumentWrite();

                // Create container for ad in the doc
                const container = doc.createElement('div');
                doc.body.appendChild(container);
                IM.writeAd(bid.ad, { id: container });

                if (doc.defaultView && doc.defaultView.frameElement) {
                    doc.defaultView.frameElement.width = bid.width;
                    doc.defaultView.frameElement.height = bid.height;
                    doc.defaultView.frameElement.dataset.seznam = true;
                    doc.defaultView.frameElement.dataset.miss = bid.ad.miss;
                }

            } catch (err) {
                console.error(err);
            }
        }
    }
};

registerBidder(spec);
