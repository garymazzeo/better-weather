/**
 * Chart.js plugins: day/night bands (exact transitions) + date strip on top chart.
 * Uses global SunCalc.getPosition for solar altitude (no extra chart deps).
 */
(function (global) {
  "use strict";

  var REFRACT_RAD = (-0.833 * Math.PI) / 180;

  function isSunUp(ms, lat, lon) {
    if (typeof SunCalc === "undefined") return true;
    try {
      var p = SunCalc.getPosition(new Date(ms), lat, lon);
      return p.altitude > REFRACT_RAD;
    } catch (e) {
      return true;
    }
  }

  function findNextFlip(lo, hi, lat, lon) {
    var dLo = isSunUp(lo + 500, lat, lon);
    var dHi = isSunUp(hi - 500, lat, lon);
    if (dLo === dHi) return null;
    while (hi - lo > 90000) {
      var mid = (lo + hi) / 2;
      if (isSunUp(mid, lat, lon) === dLo) lo = mid;
      else hi = mid;
    }
    return hi;
  }

  function segmentsForHour(t0, t1, lat, lon) {
    var segs = [];
    var cur = t0;
    var day = isSunUp(cur + 1, lat, lon);
    while (cur < t1 - 1) {
      var flip = findNextFlip(cur, t1, lat, lon);
      if (flip == null) {
        segs.push({ t0: cur, t1: t1, day: day });
        break;
      }
      segs.push({ t0: cur, t1: flip, day: day });
      day = !day;
      cur = flip;
    }
    return segs;
  }

  function timeToX(chart, hourStarts, i, t) {
    var xScale = chart.scales.x;
    if (!hourStarts || i < 0 || i >= hourStarts.length - 1) {
      return xScale.getPixelForValue(i);
    }
    var t0 = hourStarts[i];
    var t1 = hourStarts[i + 1];
    var x0 = xScale.getPixelForValue(i);
    var x1 = xScale.getPixelForValue(i + 1);
    if (t1 <= t0) return x0;
    return x0 + ((t - t0) / (t1 - t0)) * (x1 - x0);
  }

  /**
   * @param {number[]} hourStarts - UTC ms per category index
   * @param {number} lat
   * @param {number} lon
   */
  function createDayNightBackgroundPlugin(hourStarts, lat, lon) {
    return {
      id: "betterWeatherDayNight",
      beforeDatasetsDraw: function (chart) {
        if (!hourStarts || !hourStarts.length) return;
        var ctx = chart.ctx;
        var chartArea = chart.chartArea;
        var xScale = chart.scales.x;
        if (!chartArea || !xScale) return;

        var n = chart.data.labels.length;
        var night = "rgba(148, 163, 184, 0.35)";
        var day = "rgba(255, 255, 255, 0.92)";

        ctx.save();
        for (var i = 0; i < n - 1; i++) {
          var t0 = hourStarts[i];
          var t1 = hourStarts[i + 1];
          var segs = segmentsForHour(t0, t1, lat, lon);
          for (var s = 0; s < segs.length; s++) {
            var seg = segs[s];
            var xa = timeToX(chart, hourStarts, i, seg.t0);
            var xb = timeToX(chart, hourStarts, i, seg.t1);
            var left = Math.min(xa, xb);
            var right = Math.max(xa, xb);
            left = Math.max(left, chartArea.left);
            right = Math.min(right, chartArea.right);
            if (right <= left) continue;
            ctx.fillStyle = seg.day ? day : night;
            ctx.fillRect(left, chartArea.top, right - left, chartArea.bottom - chartArea.top);
          }
        }
        ctx.restore();
      },
    };
  }

  function formatDateRow(ms, timeZone) {
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: timeZone || "UTC",
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(ms));
    } catch (e) {
      return "";
    }
  }

  /**
   * Draw date labels above chart area (first panel only).
   */
  function createDateStripPlugin(hourStarts, timeZone) {
    return {
      id: "betterWeatherDateStrip",
      afterDraw: function (chart) {
        if (!hourStarts || !hourStarts.length) return;
        var ctx = chart.ctx;
        var chartArea = chart.chartArea;
        var xScale = chart.scales.x;
        if (!chartArea || !xScale) return;

        var last = "";
        ctx.save();
        ctx.font =
          '600 11px system-ui, "Outfit", "Segoe UI", sans-serif';
        ctx.fillStyle = "#334155";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";

        var yText = chartArea.top - 4;
        for (var i = 0; i < hourStarts.length; i++) {
          var row = formatDateRow(hourStarts[i], timeZone);
          if (row === last) continue;
          last = row;
          var x = xScale.getPixelForValue(i);
          if (x < chartArea.left || x > chartArea.right) continue;
          var xMid = x;
          var j = i + 1;
          while (j < hourStarts.length && formatDateRow(hourStarts[j], timeZone) === row) {
            j++;
          }
          if (j > i + 1) {
            var xEnd = xScale.getPixelForValue(j - 1);
            xMid = (x + xEnd) / 2;
          }
          ctx.fillText(row, xMid, yText);
        }
        ctx.restore();
      },
    };
  }

  global.BetterWeatherChartPlugins = {
    createDayNightBackgroundPlugin: createDayNightBackgroundPlugin,
    createDateStripPlugin: createDateStripPlugin,
    isSunUp: isSunUp,
  };
})(typeof window !== "undefined" ? window : this);
