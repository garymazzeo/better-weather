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
        /* Dark chart panels: deeper night wash, slightly lifted day band */
        var night = "rgba(15, 23, 42, 0.55)";
        var day = "rgba(71, 85, 105, 0.28)";

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
          '600 12px system-ui, "Outfit", "Segoe UI", sans-serif';
        ctx.fillStyle = "#cbd5e1";
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

  /**
   * Hourly wind vectors: anchored at the wind-speed point on the line; stem extends downstream
   * (NWS windDirection = FROM). Thin line + strokes near tip ~12 mph each (no arrowhead).
   */
  function createWindVectorPlugin(hourStarts, windDirectionFromDeg, windMph, windSpeedDatasetIndex) {
    windSpeedDatasetIndex = windSpeedDatasetIndex == null ? 0 : windSpeedDatasetIndex;
    return {
      id: "betterWeatherWindVectors",
      afterDatasetsDraw: function (chart) {
        if (!hourStarts || !hourStarts.length) return;
        if (!windDirectionFromDeg || !windDirectionFromDeg.length) return;
        var ctx = chart.ctx;
        var area = chart.chartArea;
        var yScale = chart.scales.y;
        if (!ctx || !area || !yScale) return;

        var metaSpeed = chart.getDatasetMeta(windSpeedDatasetIndex);
        if (!metaSpeed || metaSpeed.hidden || !metaSpeed.data) return;

        var n = hourStarts.length;
        var mphMax = isFinite(yScale.max) ? yScale.max : 40;
        if (mphMax <= 0) mphMax = 40;

        var DEG = Math.PI / 180;

        ctx.save();
        ctx.strokeStyle = "rgba(203, 213, 225, 0.78)";
        ctx.lineWidth = 1;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        for (var i = 0; i < n; i++) {
          var dir = windDirectionFromDeg[i];
          if (dir == null || isNaN(dir)) continue;
          var mph = windMph[i];
          if (mph == null || isNaN(mph) || mph <= 0) continue;

          var pt = metaSpeed.data[i];
          if (!pt || typeof pt.x !== "number" || typeof pt.y !== "number") continue;
          var anchorX = pt.x;
          var anchorY = pt.y;
          if (anchorX < area.left - 2 || anchorX > area.right + 2) continue;
          if (anchorY < area.top - 2 || anchorY > area.bottom + 2) continue;

          var rad = Number(dir) * DEG;
          var ux = -Math.sin(rad);
          var uy = Math.cos(rad);
          var px = -uy;
          var py = ux;

          var len = 6 + Math.min(mph / Math.max(mphMax, 8), 1) * 20;
          len = Math.min(len, 26);

          var x0 = anchorX;
          var y0 = anchorY;
          var x1 = anchorX + ux * len;
          var y1 = anchorY + uy * len;

          var maxY = area.top + 2;
          if (y1 < maxY) {
            var scale = (anchorY - maxY) / (anchorY - y1);
            if (scale > 0 && scale < 1) {
              x1 = anchorX + ux * len * scale;
              y1 = anchorY + uy * len * scale;
            }
          }

          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();

          var k = Math.min(6, Math.floor(mph / 12));
          var tickLen = 4;
          for (var t = 1; t <= k; t++) {
            var back = 3 + t * 3;
            var tx = x1 - ux * back;
            var ty = y1 - uy * back;
            ctx.beginPath();
            ctx.moveTo(tx, ty);
            ctx.lineTo(tx + px * tickLen, ty + py * tickLen);
            ctx.stroke();
          }
        }
        ctx.restore();
      },
    };
  }

  global.BetterWeatherChartPlugins = {
    createDayNightBackgroundPlugin: createDayNightBackgroundPlugin,
    createDateStripPlugin: createDateStripPlugin,
    createWindVectorPlugin: createWindVectorPlugin,
    isSunUp: isSunUp,
  };
})(typeof window !== "undefined" ? window : this);
