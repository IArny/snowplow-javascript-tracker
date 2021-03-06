/*
 * JavaScript tracker for Snowplow: tests/functional/helpers.js
 *
 * Significant portions copyright 2010 Anthon Pang. Remainder copyright
 * 2012-2016 Snowplow Analytics Ltd. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 * * Redistributions of source code must retain the above copyright
 *   notice, this list of conditions and the following disclaimer.
 *
 * * Redistributions in binary form must reproduce the above copyright
 *   notice, this list of conditions and the following disclaimer in the
 *   documentation and/or other materials provided with the distribution.
 *
 * * Neither the name of Anthon Pang nor Snowplow Analytics Ltd nor the
 *   names of their contributors may be used to endorse or promote products
 *   derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

define([
  'intern!object',
  'intern/chai!assert',
  'intern/dojo/node!lodash',
  'intern/dojo/node!http',
  'intern/dojo/node!url',
  "intern/dojo/node!js-base64"
], function(registerSuite, assert, lodash, http, url, jsBase64) {
  var decodeBase64 = jsBase64.Base64.fromBase64;

  /**
   * Expected amount of request for each browser
   * This must be increased when new tracking call added to
   * pages/integration-template.html
   */
  var log = [];

  function pageViewsHaveDifferentIds () {
    var pageViews = lodash.filter(log, function (logLine) {
      return logLine.e === 'pv';
    });
    var contexts = lodash.map(pageViews, function (logLine) {
      var data = JSON.parse(decodeBase64(logLine.cx)).data;
      return lodash.find(data, function (context) {
        return context.schema === 'iglu:com.snowplowanalytics.snowplow/web_page/jsonschema/1-0-0';
      });
    });
    var ids = lodash.map(contexts, function (wpContext) {
      return wpContext.data.id;
    });

    return lodash.uniq(ids).length >= 2;
  }

  function allEventsHaveGdprContext () {
    let lenEvents = log.length;
    let withGdpr = lodash.filter(log, function (logLine) {
      let data = JSON.parse(decodeBase64(logLine.cx)).data;
      return lodash.find(data, function (context) {
        return context.schema === 'iglu:com.snowplowanalytics.snowplow/gdpr/jsonschema/1-0-0';
      });
    });
    let lenGdpr = withGdpr.length;
    return lenEvents === lenGdpr;
  }

  /**
   * Check if expected payload exists in `log`
     */
  function checkExistenceOfExpectedQuerystring(expected) {
    function compare(e, other) {  // e === expected
      var result = lodash.map(e, function (v, k) {
        if (lodash.isFunction(v)) { return v(other[k]); }
        else { return lodash.isEqual(v, other[k]); }
      });
      return lodash.every(result);
    }

    function strip(logLine) {
      var expectedKeys = lodash.keys(expected);
      var stripped = lodash.pickBy(logLine, function (v, k) { return lodash.includes(expectedKeys, k); });
      if (lodash.keys(stripped).length !== expectedKeys.length) { return null; }
      else { return stripped; }
    }

    return lodash.some(log, function (logLine) {
      var stripped = strip(logLine);
      if (stripped == null) { return false; }
      else { return lodash.isEqualWith(expected, stripped, compare); }
    });
  }

  function someTestsFailed(suite) {
    return lodash.some(suite.tests, function (test) { return test.error !== null; });
  }

  // Ngrok must be running to forward requests to localhost
  http.createServer(function (request, response) {
    response.writeHead(200, {'Content-Type': 'image/gif'});

    if (request.method === 'GET') {
      var payload = url.parse(request.url, true).query;
      log.push(payload);
    }

    var img = new Buffer('47494638396101000100800000dbdfef00000021f90401000000002c00000000010001000002024401003b', 'hex');
    response.end(img, 'binary');

  }).listen(8500, function () { console.log("Collector mock running...\n"); });

  registerSuite({

    teardown: function () {
      if (someTestsFailed(this)) {
        console.log("Tests failed with following log:");
        lodash.forEach(log, function (l) { console.log(l); });
      }
      console.log("Cleaning log");
      log = [];
    },

    name: 'Test that request_recorder logs meet expectations',

    'Check existence of page view in log': function () {
      assert.isTrue(checkExistenceOfExpectedQuerystring({
        e: 'pv',
        p: 'mob',
        aid: 'CFe23a',
        uid: 'Malcolm',
        page: 'My Title',
        cx: function (cx) {
          var contexts = JSON.parse(decodeBase64(cx)).data;
          return lodash.some(contexts,
            lodash.matches({
              schema:"iglu:com.example_company/user/jsonschema/2-0-0",
              data:{
                userType:'tester'
              }
            })
          );
        }
      }), 'A page view should be detected');
    },

    'Check nonexistence of nonexistent event types in log': function () {
      assert.isFalse(checkExistenceOfExpectedQuerystring({
        e: 'ad'
      }), 'No nonexistent event type should be detected');
    },

    'Check a structured event was sent': function () {
      assert.isTrue(checkExistenceOfExpectedQuerystring({
        e: 'se',
        se_ca: 'Mixes',
        se_ac: 'Play',
        se_la: 'MRC/fabric-0503-mix',
        se_va: '0.0'
      }), 'A structured event should be detected');
    },

    'Check an unstructured event with true timestamp was sent': function () {
      assert.isTrue(checkExistenceOfExpectedQuerystring({
        e: 'ue',
        ue_px: 'eyJzY2hlbWEiOiJpZ2x1OmNvbS5zbm93cGxvd2FuYWx5dGljcy5zbm93cGxvdy91bnN0cnVjdF9ldmVudC9qc29uc2NoZW1hLzEtMC0wIiwiZGF0YSI6eyJzY2hlbWEiOiJpZ2x1OmNvbS5hY21lX2NvbXBhbnkvdmlld2VkX3Byb2R1Y3QvanNvbnNjaGVtYS81LTAtMCIsImRhdGEiOnsicHJvZHVjdElkIjoiQVNPMDEwNDMifX19',
        ttm: '1477401868'
      }), 'An unstructured event should be detected');
    },

    'Check a transaction event was sent': function () {
      assert.isTrue(checkExistenceOfExpectedQuerystring({
        e: 'tr',
        tr_id: 'order-123',
        tr_af: 'acme',
        tr_tt: '8000',
        tr_tx: '100',
        tr_ci: 'phoenix',
        tr_st: 'arizona',
        tr_co: 'USA',
        tr_cu: 'JPY'
      }), 'A transaction event should be detected');
    },

    'Check a transaction item event was sent': function () {
      assert.isTrue(checkExistenceOfExpectedQuerystring({
        e: 'ti',
        ti_id: 'order-123',
        ti_sk: '1001',
        ti_nm: 'Blue t-shirt',
        ti_ca: 'clothing',
        ti_pr: '2000',
        ti_qu: '2',
        ti_cu: 'JPY'
      }), 'A transaction item event should be detected');
    },

    'Check an unhandled exception was sent': function () {
      assert.isTrue(checkExistenceOfExpectedQuerystring({
        ue_px: function (ue) {
          var event = JSON.parse(decodeBase64(ue)).data;
          // We cannot test more because implementations vary much in old browsers (FF27,IE9)
          return (event.schema === 'iglu:com.snowplowanalytics.snowplow/application_error/jsonschema/1-0-1') &&
            (event.data.programmingLanguage === 'JAVASCRIPT') &&
            (event.data.message != null);
        }
      }));
    },

    'Check pageViewId is regenerated for each trackPageView': function () {
      assert.isTrue(pageViewsHaveDifferentIds());
    },

    'Check global contexts are for structured events': function () {
      assert.isTrue(checkExistenceOfExpectedQuerystring({
        e: 'se',
        cx: function (cx) {
          var contexts = JSON.parse(decodeBase64(cx)).data;
          return 2 === lodash.size(
            lodash.filter(contexts,
              lodash.overSome(
                lodash.matches({
                  schema: "iglu:com.snowplowanalytics.snowplow/mobile_context/jsonschema/1-0-1",
                  data: {
                    osType: 'ubuntu'
                  }
                }),
                lodash.matches({
                  schema: 'iglu:com.snowplowanalytics.snowplow/geolocation_context/jsonschema/1-1-0',
                  data: {
                    'latitude': 40.0,
                    'longitude': 55.1
                  }
                })
              )
            )
          );
        }
      }));
    },

    'Check an unstructured event with global context from accept ruleset': function () {
      assert.isTrue(checkExistenceOfExpectedQuerystring({
        e: 'ue',
        ue_px: function (ue_px) {
          var event = JSON.parse(decodeBase64(ue_px)).data;
          return lodash.isMatch(event,
            {
              schema:"iglu:com.acme_company/viewed_product/jsonschema/5-0-0",
              data:{
                productId: 'ASO01042'
              }
            }
          );
        },
        cx: function (cx) {
          var contexts = JSON.parse(decodeBase64(cx)).data;
          return 2 === lodash.size(
            lodash.filter(contexts,
              lodash.overSome(
                lodash.matches({
                  schema: "iglu:com.snowplowanalytics.snowplow/mobile_context/jsonschema/1-0-1",
                  data: {
                    osType: 'ubuntu'
                  }
                }),
                lodash.matches({
                  schema: 'iglu:com.snowplowanalytics.snowplow/geolocation_context/jsonschema/1-1-0',
                  data: {
                    'latitude': 40.0,
                    'longitude': 55.1
                  }
                })
              )
            )
          );
        }
      }), 'An unstructured event with global contexts should be detected');
    },

    'Check an unstructured event missing global context from reject ruleset': function () {
      assert.isTrue(checkExistenceOfExpectedQuerystring({
        e: 'ue',
        ue_px: function (ue_px) {
          var event = JSON.parse(decodeBase64(ue_px)).data;
          return lodash.isMatch(event,
            {
              schema:"iglu:com.acme_company/viewed_product/jsonschema/5-0-0",
              data:{
                productId: 'ASO01041'
              }
            }
          );
        },
        cx: function (cx) {
          var contexts = JSON.parse(decodeBase64(cx)).data;
          return 0 === lodash.size(
            lodash.filter(contexts,
              lodash.overSome(
                lodash.matches({
                  schema: "iglu:com.snowplowanalytics.snowplow/mobile_context/jsonschema/1-0-1",
                  data: {
                    osType: 'ubuntu'
                  }
                }),
                lodash.matches({
                  schema: 'iglu:com.snowplowanalytics.snowplow/geolocation_context/jsonschema/1-1-0',
                  data: {
                    'latitude': 40.0,
                    'longitude': 55.1
                  }
                })
              )
            )
          );
        }
      }), 'An unstructured event without global contexts should be detected');
    },

    'Check a GDPR context': function () {
      assert.isTrue(checkExistenceOfExpectedQuerystring({
        cx: function (cx) {
          var contexts = JSON.parse(decodeBase64(cx)).data;
          return 1 === lodash.size(
            lodash.filter(contexts,
              lodash.overSome(
                lodash.matches({
                  schema: "iglu:com.snowplowanalytics.snowplow/gdpr/jsonschema/1-0-0",
                  data: {
                    'basisForProcessing': 'consent',
                    'documentId': 'someId',
                    'documentVersion': '0.1.0',
                    'documentDescription': 'this document is a test'
                  }
                })
              )
            )
          );
        }
      }), 'An event with GDPR context should be detected');
    },

    'Check that all events have a GDPR context attached': function() {
      assert.isTrue(allEventsHaveGdprContext ());
    }
  });
});
