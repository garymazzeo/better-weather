/**
 * NWS forecastGridData: parse ISO validTime intervals and align to an hourly timeline.
 * Exposes BetterWeatherGrid on window.
 */
(function (global) {
  "use strict";

  /**
   * Parse "2026-04-10T14:00:00+00:00/PT1H" or "2026-04-10T14:00:00+00:00/P3DT10H"
   * @returns {{ startMs: number, endMs: number } | null}
   */
  function parseValidTimeInterval(str) {
    if (!str || typeof str !== "string") return null;
    var slash = str.indexOf("/");
    if (slash < 0) return null;
    var startStr = str.slice(0, slash);
    var durStr = str.slice(slash + 1);
    var startMs = Date.parse(startStr);
    if (isNaN(startMs)) return null;
    var durMs = parseIsoDurationMs(durStr);
    if (durMs == null || durMs <= 0) return null;
    return { startMs: startMs, endMs: startMs + durMs };
  }

  /** ISO 8601 duration to milliseconds (P…D, PT…H, M, S; combined). */
  function parseIsoDurationMs(s) {
    if (!s || s[0] !== "P") return null;
    var days = 0;
    var hours = 0;
    var minutes = 0;
    var seconds = 0;
    var tIndex = s.indexOf("T");
    var datePart = tIndex >= 0 ? s.slice(1, tIndex) : s.slice(1);
    var timePart = tIndex >= 0 ? s.slice(tIndex + 1) : "";

    var dm = datePart.match(/(\d+)D/);
    if (dm) days += parseInt(dm[1], 10);

    if (timePart) {
      var hm = timePart.match(/(\d+)H/);
      if (hm) hours += parseInt(hm[1], 10);
      var mm = timePart.match(/(\d+)M/);
      if (mm) minutes += parseInt(mm[1], 10);
      var sm = timePart.match(/(\d+(?:\.\d+)?)S/);
      if (sm) seconds += parseFloat(sm[1]);
    }

    return (
      ((days * 24 + hours) * 60 + minutes) * 60 + seconds
    ) * 1000;
  }

  function floorToHour(ms) {
    return Math.floor(ms / 3600000) * 3600000;
  }

  function ceilToHour(ms) {
    return Math.ceil(ms / 3600000) * 3600000;
  }

  /** NWS coverage string -> ordinal 0–4 (SChc…Ocnl style). */
  function coverageOrdinal(coverage) {
    if (!coverage || typeof coverage !== "string") return 0;
    var c = coverage.toLowerCase();
    if (c.indexOf("slight") >= 0 || c.indexOf("schc") >= 0) return 1;
    if (c.indexOf("chance") >= 0 || c === "chc") return 2;
    if (c.indexOf("likely") >= 0 || c === "lkly") return 3;
    if (
      c.indexOf("definite") >= 0 ||
      c.indexOf("ocnl") >= 0 ||
      c.indexOf("numerous") >= 0 ||
      c.indexOf("widespread") >= 0
    )
      return 4;
    return 0;
  }

  function tokenOrdinal(weatherToken) {
    if (!weatherToken || typeof weatherToken !== "string") return 0;
    var w = weatherToken.toLowerCase();
    if (w.indexOf("thunder") >= 0) return 4;
    if (w.indexOf("rain") >= 0 || w.indexOf("shower") >= 0 || w.indexOf("drizzle") >= 0)
      return 3;
    if (w.indexOf("snow") >= 0 || w.indexOf("flurr") >= 0 || w.indexOf("blizzard") >= 0)
      return 3;
    if (w.indexOf("freezing rain") >= 0 || w.indexOf("freezing drizzle") >= 0) return 3;
    if (w.indexOf("sleet") >= 0 || w.indexOf("ice pellet") >= 0) return 3;
    return 0;
  }

  function classifyWeatherEntry(entry) {
    var cov = coverageOrdinal(entry.coverage);
    var wx = (entry.weather || "").toLowerCase();
    var base = Math.max(cov, tokenOrdinal(entry.weather));
    return {
      rain: /rain|shower|drizzle/.test(wx) ? Math.max(base, cov || 1) : 0,
      thunder: /thunder/.test(wx) ? Math.max(base, cov || 1) : 0,
      snow: /snow|flurr|blizzard/.test(wx) ? Math.max(base, cov || 1) : 0,
      freezingRain: /freezing rain|freezing drizzle/.test(wx) ? Math.max(base, cov || 1) : 0,
      sleet: /sleet|ice pellets/.test(wx) ? Math.max(base, cov || 1) : 0,
    };
  }

  function mergeWeatherMax(target, add) {
    target.rain = Math.max(target.rain, add.rain);
    target.thunder = Math.max(target.thunder, add.thunder);
    target.snow = Math.max(target.snow, add.snow);
    target.freezingRain = Math.max(target.freezingRain, add.freezingRain);
    target.sleet = Math.max(target.sleet, add.sleet);
  }

  /**
   * For each hour start in [rangeStart, rangeEnd), apply last overlapping sample value.
   * @param {Array<{validTime: string, value: *}>} values
   * @param {function(*): number|null} mapValue
   */
  function alignNumericSeries(values, hourStarts, rangeStart, rangeEnd, mapValue) {
    var out = [];
    for (var h = 0; h < hourStarts.length; h++) {
      out.push(null);
    }
    if (!values || !values.length) return out;

    for (var i = 0; i < values.length; i++) {
      var row = values[i];
      var iv = parseValidTimeInterval(row.validTime);
      if (!iv) continue;
      var v = mapValue(row.value);
      if (v == null || isNaN(v)) continue;
      var h0 = Math.max(floorToHour(iv.startMs), rangeStart);
      var h1 = Math.min(ceilToHour(iv.endMs), rangeEnd);
      for (var t = h0; t < h1; t += 3600000) {
        var idx = Math.floor((t - rangeStart) / 3600000);
        if (idx >= 0 && idx < out.length) out[idx] = v;
      }
    }
    return out;
  }

  function alignWeatherSeries(values, hourStarts, rangeStart, rangeEnd) {
    var out = [];
    for (var h = 0; h < hourStarts.length; h++) {
      out.push({
        rain: 0,
        thunder: 0,
        snow: 0,
        freezingRain: 0,
        sleet: 0,
      });
    }
    if (!values || !values.length) return out;

    for (var i = 0; i < values.length; i++) {
      var row = values[i];
      var iv = parseValidTimeInterval(row.validTime);
      if (!iv) continue;
      var list = row.value;
      if (!Array.isArray(list)) continue;
      var agg = { rain: 0, thunder: 0, snow: 0, freezingRain: 0, sleet: 0 };
      for (var j = 0; j < list.length; j++) {
        mergeWeatherMax(agg, classifyWeatherEntry(list[j] || {}));
      }
      if (
        agg.rain === 0 &&
        agg.thunder === 0 &&
        agg.snow === 0 &&
        agg.freezingRain === 0 &&
        agg.sleet === 0
      )
        continue;

      var h0 = Math.max(floorToHour(iv.startMs), rangeStart);
      var h1 = Math.min(ceilToHour(iv.endMs), rangeEnd);
      for (var t = h0; t < h1; t += 3600000) {
        var idx = Math.floor((t - rangeStart) / 3600000);
        if (idx >= 0 && idx < out.length) mergeWeatherMax(out[idx], agg);
      }
    }
    return out;
  }

  function layerValues(props, key) {
    var L = props[key];
    if (!L || !Array.isArray(L.values)) return [];
    return L.values;
  }

  function cToF(c) {
    if (c == null || isNaN(c)) return null;
    return (c * 9) / 5 + 32;
  }

  function kmhToMph(kmh) {
    if (kmh == null || isNaN(kmh)) return null;
    return kmh * 0.621371;
  }

  /**
   * @param {object} gridGeoJson - full /gridpoints/{wfo}/{x},{y} Feature
   * @returns {object} timeline + aligned series
   */
  function buildHourlyTimeline(gridGeoJson) {
    var props = (gridGeoJson && gridGeoJson.properties) || {};
    var keys = [
      "temperature",
      "dewpoint",
      "windChill",
      "windSpeed",
      "windDirection",
      "windGust",
      "relativeHumidity",
      "probabilityOfPrecipitation",
      "skyCover",
      "probabilityOfThunder",
      "quantitativePrecipitation",
    ];

    var minStart = Infinity;
    var maxEnd = -Infinity;

    function considerLayer(k) {
      var vals = layerValues(props, k);
      for (var i = 0; i < vals.length; i++) {
        var iv = parseValidTimeInterval(vals[i].validTime);
        if (!iv) continue;
        minStart = Math.min(minStart, iv.startMs);
        maxEnd = Math.max(maxEnd, iv.endMs);
      }
    }

    for (var ki = 0; ki < keys.length; ki++) considerLayer(keys[ki]);
    var wvals = layerValues(props, "weather");
    for (var wi = 0; wi < wvals.length; wi++) {
      var wiv = parseValidTimeInterval(wvals[wi].validTime);
      if (wiv) {
        minStart = Math.min(minStart, wiv.startMs);
        maxEnd = Math.max(maxEnd, wiv.endMs);
      }
    }

    if (!isFinite(minStart) || !isFinite(maxEnd) || maxEnd <= minStart) {
      return {
        hourStarts: [],
        hourMs: [],
        temperatureF: [],
        dewpointF: [],
        windChillF: [],
        windMph: [],
        windDirectionDeg: [],
        gustMph: [],
        relativeHumidity: [],
        pop: [],
        skyCover: [],
        thunderPct: [],
        weather: [],
        quantitativePrecipitationInches: [],
        updateTime: props.updateTime || null,
      };
    }

    var rangeStart = floorToHour(minStart);
    var rangeEnd = ceilToHour(maxEnd);

    // Clamp the displayed timeline to start at the user's current hour (when within range).
    var nowFloorHour = floorToHour(Date.now());
    if (nowFloorHour > rangeStart && nowFloorHour < rangeEnd) {
      rangeStart = nowFloorHour;
    }

    var hourStarts = [];
    for (var t = rangeStart; t < rangeEnd; t += 3600000) {
      hourStarts.push(t);
    }

    var id = function (x) {
      return typeof x === "number" ? x : null;
    };

    var tempC = alignNumericSeries(
      layerValues(props, "temperature"),
      hourStarts,
      rangeStart,
      rangeEnd,
      id
    );
    var dewC = alignNumericSeries(
      layerValues(props, "dewpoint"),
      hourStarts,
      rangeStart,
      rangeEnd,
      id
    );
    var wcC = alignNumericSeries(
      layerValues(props, "windChill"),
      hourStarts,
      rangeStart,
      rangeEnd,
      id
    );
    var windKmh = alignNumericSeries(
      layerValues(props, "windSpeed"),
      hourStarts,
      rangeStart,
      rangeEnd,
      id
    );
    var windDirectionDeg = alignNumericSeries(
      layerValues(props, "windDirection"),
      hourStarts,
      rangeStart,
      rangeEnd,
      id
    );
    var gustKmh = alignNumericSeries(
      layerValues(props, "windGust"),
      hourStarts,
      rangeStart,
      rangeEnd,
      id
    );
    var rh = alignNumericSeries(
      layerValues(props, "relativeHumidity"),
      hourStarts,
      rangeStart,
      rangeEnd,
      id
    );
    var pop = alignNumericSeries(
      layerValues(props, "probabilityOfPrecipitation"),
      hourStarts,
      rangeStart,
      rangeEnd,
      id
    );
    var sky = alignNumericSeries(
      layerValues(props, "skyCover"),
      hourStarts,
      rangeStart,
      rangeEnd,
      id
    );
    var thunder = alignNumericSeries(
      layerValues(props, "probabilityOfThunder"),
      hourStarts,
      rangeStart,
      rangeEnd,
      id
    );

    var weather = alignWeatherSeries(wvals, hourStarts, rangeStart, rangeEnd);

    var qpfLayerMeta = props.quantitativePrecipitation;
    var qpfUom = (qpfLayerMeta && qpfLayerMeta.uom && String(qpfLayerMeta.uom)) || "";
    function qpfToInches(v) {
      if (v == null || typeof v !== "number" || isNaN(v)) return null;
      var u = qpfUom.toLowerCase();
      if (u.indexOf("mm") >= 0) return v / 25.4;
      if (u.indexOf("m") >= 0 && u.indexOf("mm") < 0) return v * 39.3700787;
      return v;
    }
    var quantitativePrecipitationInches = alignNumericSeries(
      layerValues(props, "quantitativePrecipitation"),
      hourStarts,
      rangeStart,
      rangeEnd,
      qpfToInches
    );

    var temperatureF = tempC.map(cToF);
    var dewpointF = dewC.map(cToF);
    var windChillF = wcC.map(cToF);
    var windMph = windKmh.map(kmhToMph);
    var gustMph = gustKmh.map(kmhToMph);

    return {
      hourStarts: hourStarts,
      hourMs: hourStarts.slice(),
      temperatureF: temperatureF,
      dewpointF: dewpointF,
      windChillF: windChillF,
      windMph: windMph,
      windDirectionDeg: windDirectionDeg,
      gustMph: gustMph,
      relativeHumidity: rh,
      pop: pop,
      skyCover: sky,
      thunderPct: thunder,
      weather: weather,
      quantitativePrecipitationInches: quantitativePrecipitationInches,
      updateTime: props.updateTime || null,
      rangeStartMs: rangeStart,
      rangeEndMs: rangeEnd,
    };
  }

  global.BetterWeatherGrid = {
    parseValidTimeInterval: parseValidTimeInterval,
    buildHourlyTimeline: buildHourlyTimeline,
    coverageOrdinal: coverageOrdinal,
  };
})(typeof window !== "undefined" ? window : this);
