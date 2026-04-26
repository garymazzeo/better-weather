/**
 * Better Weather — NWS grid forecast, multi-panel Chart.js (weather.gov style).
 */

(function () {
  "use strict";

  var gridCharts = [];

  function $(id) {
    return document.getElementById(id);
  }

  function roundCoord(n) {
    return Math.round(Number(n) * 10000) / 10000;
  }

  function showStatus(message, kind) {
    var el = $("status-banner");
    if (!el) return;
    el.hidden = false;
    el.textContent = message;
    el.className = "status-banner";
    if (kind === "loading") el.classList.add("status-banner--loading");
    if (kind === "error") el.classList.add("status-banner--error");
    el.setAttribute("role", kind === "error" ? "alert" : "status");
  }

  function hideStatus() {
    var el = $("status-banner");
    if (!el) return;
    el.hidden = true;
    el.textContent = "";
    el.setAttribute("role", "status");
  }

  function setLoading(isLoading) {
    var extraBtns = [
      "btn-geolocate",
      "btn-geolocate-hero",
      "btn-change-location",
      "btn-load-coords",
      "btn-load-coords-hero",
    ];
    for (var b = 0; b < extraBtns.length; b++) {
      var el = $(extraBtns[b]);
      if (el) el.disabled = isLoading;
    }
    var form = $("form-coords");
    if (form) {
      var inputs = form.querySelectorAll("button, input");
      for (var i = 0; i < inputs.length; i++) inputs[i].disabled = isLoading;
    }
  }

  function tryCloseLocationDialog() {
    var dlg = $("location-dialog");
    if (!dlg || typeof dlg.close !== "function") return;
    try {
      if (dlg.open) dlg.close();
    } catch (e) {
      /* ignore */
    }
  }

  function apiPoints(lat, lon) {
    var q =
      "lat=" + encodeURIComponent(String(lat)) + "&lon=" + encodeURIComponent(String(lon));
    return fetch("/api/points.php?" + q).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          var err = (data && data.error) || res.statusText || "Request failed";
          throw new Error(err);
        }
        return data;
      });
    });
  }

  function apiNws(url) {
    return fetch("/api/nws.php?url=" + encodeURIComponent(url)).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          var err = (data && data.error) || res.statusText || "Request failed";
          throw new Error(err);
        }
        return data;
      });
    });
  }

  function formatShortTime(iso) {
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch (e) {
      return iso;
    }
  }

  /** Shorter hour labels to reduce overlap on wide timelines. */
  function formatHourTickCompact(ms, timeZone) {
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: timeZone || "UTC",
        hour: "numeric",
      }).format(new Date(ms));
    } catch (e) {
      return "";
    }
  }

  function buildXTickPlan(hourStarts, timeZone, n) {
    var stride = 2;
    if (n > 200) stride = 5;
    else if (n > 150) stride = 4;
    else if (n > 110) stride = 3;
    var labels = [];
    for (var li = 0; li < n; li++) {
      labels.push(
        li % stride === 0 ? formatHourTickCompact(hourStarts[li], timeZone) : ""
      );
    }
    var maxRotation = 0;
    var bottomPad = 6;
    if (n > 72) {
      maxRotation = 32;
      bottomPad = 18;
    }
    if (n > 130) {
      maxRotation = 42;
      bottomPad = 22;
    }
    return { labels: labels, maxRotation: maxRotation, bottomPad: bottomPad };
  }

  function clearHtmlLegends() {
    var ids = [
      "legend-panel-a",
      "legend-panel-b",
      "legend-panel-c",
      "legend-panel-d",
      "legend-panel-e",
    ];
    for (var i = 0; i < ids.length; i++) {
      var ul = $(ids[i]);
      if (ul) ul.innerHTML = "";
    }
  }

  function fillHtmlLegend(ulId, datasets) {
    var ul = $(ulId);
    if (!ul || !datasets || !datasets.length) return;
    ul.innerHTML = "";
    for (var i = 0; i < datasets.length; i++) {
      var ds = datasets[i];
      var color = ds.borderColor || ds.backgroundColor || "#94a3b8";
      var li = document.createElement("li");
      li.className = "stacked-charts__legend-item";
      var sw = document.createElement("span");
      sw.className = "stacked-charts__legend-swatch";
      sw.style.backgroundColor = color;
      var lab = document.createElement("span");
      lab.className = "stacked-charts__legend-text";
      lab.textContent = ds.label || "";
      li.appendChild(sw);
      li.appendChild(lab);
      ul.appendChild(li);
    }
  }

  function seriesPositiveMax(arr) {
    var m = 0;
    if (!arr || !arr.length) return 0;
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (v != null && !isNaN(v) && v > m) m = v;
    }
    return m;
  }

  function destroyGridCharts() {
    for (var i = 0; i < gridCharts.length; i++) {
      if (gridCharts[i]) gridCharts[i].destroy();
    }
    gridCharts = [];
  }

  function hasNumericSeries(arr) {
    if (!arr || !arr.length) return false;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] != null && !isNaN(arr[i])) return true;
    }
    return false;
  }

  function hasWeatherSeries(wx) {
    if (!wx || !wx.length) return false;
    for (var i = 0; i < wx.length; i++) {
      var w = wx[i];
      if (w.rain || w.thunder || w.snow || w.freezingRain || w.sleet) return true;
    }
    return false;
  }

  function thunderDisplay(wx, thunderPct) {
    var out = [];
    for (var i = 0; i < wx.length; i++) {
      var p = thunderPct[i];
      var tOrd = wx[i] ? wx[i].thunder : 0;
      var bump = tOrd > 0 ? Math.min(100, tOrd * 22) : null;
      if (p != null && !isNaN(p)) {
        out.push(bump == null ? p : Math.max(p, bump));
      } else {
        out.push(bump);
      }
    }
    return out;
  }

  function setWrapVisible(id, vis) {
    var el = $(id);
    if (el) el.hidden = !vis;
  }

  var PX_PER_CHART_HOUR = 16;

  function chartTextDefaults() {
    return {
      color: "#e2e8f0",
      font: { size: 13, family: 'system-ui, "Outfit", sans-serif' },
    };
  }

  function chartLegendHidden() {
    return { display: false };
  }

  function xScaleConfig(labels, showTickLabels, tickPlan) {
    tickPlan = tickPlan || {};
    var maxRot = tickPlan.maxRotation != null ? tickPlan.maxRotation : 0;
    return {
      ticks: Object.assign(
        {
          autoSkip: false,
          maxRotation: maxRot,
          minRotation: maxRot > 0 ? Math.min(8, maxRot) : 0,
          color: "#94a3b8",
          callback: function (_val, idx) {
            return labels[idx] || "";
          },
        },
        showTickLabels ? {} : { display: false }
      ),
      grid: { color: "rgba(255, 255, 255, 0.06)" },
    };
  }

  function yGridLight() {
    return { color: "rgba(255, 255, 255, 0.06)" };
  }

  function ordinalTickCallback(value) {
    var map = ["", "SChc", "Chc", "Lkly", "Ocnl"];
    var v = Math.round(Number(value));
    return map[v] || "";
  }

  /** Wind chart: padded max, snapped to 5 mph for clean ticks. */
  function windAxisMaxMph(speedArr, gustArr) {
    var m = 0;
    function consider(arr) {
      if (!arr || !arr.length) return;
      for (var i = 0; i < arr.length; i++) {
        var v = arr[i];
        if (v != null && !isNaN(v) && v > m) m = v;
      }
    }
    consider(speedArr);
    consider(gustArr);
    if (m <= 0) m = 15;
    var headroom = Math.max(10, Math.ceil(m * 0.22));
    var target = m + headroom;
    var rounded = Math.ceil(target / 5) * 5;
    return Math.max(rounded, 25);
  }

  function makePointValueLabelsPlugin(pointStrideH) {
    return {
      id: "betterWeatherPointValueLabels",
      afterDatasetsDraw: function (chart) {
        if (!pointStrideH || pointStrideH < 1) return;
        var ctx = chart.ctx;
        var area = chart.chartArea;
        if (!ctx || !area) return;
        var t = chartTextDefaults();

        ctx.save();
        ctx.font = '600 11px system-ui, "Outfit", sans-serif';
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";

        for (var di = 0; di < chart.data.datasets.length; di++) {
          var ds = chart.data.datasets[di];
          var meta = chart.getDatasetMeta(di);
          if (!meta || meta.hidden) continue;
          var data = ds.data || [];
          for (var i = 0; i < data.length; i++) {
            if (i % pointStrideH !== 0) continue;
            var v = data[i];
            if (v == null || isNaN(v) || v === 0) continue;
            var el = meta.data && meta.data[i];
            if (!el) continue;
            var x = el.x;
            var y = el.y;
            if (x == null || y == null) continue;
            if (x < area.left || x > area.right || y < area.top || y > area.bottom) continue;

            var s = "";
            if (typeof v === "number") {
              if (Math.abs(v) >= 100) s = String(Math.round(v));
              else if (Math.abs(v) >= 10) s = String(Math.round(v));
              else if (Math.abs(v) >= 1) s = String(Math.round(v * 10) / 10);
              else s = String(Math.round(v * 100) / 100);
            } else {
              s = String(v);
            }

            var dy = 8;
            ctx.lineWidth = 3.5;
            ctx.strokeStyle = "rgba(15, 20, 29, 0.75)";
            ctx.fillStyle = t.color;
            ctx.strokeText(s, x, y - dy);
            ctx.fillText(s, x, y - dy);
          }
        }
        ctx.restore();
      },
    };
  }

  function buildGridCharts(pointsData, timeline) {
    destroyGridCharts();
    clearHtmlLegends();

    if (
      typeof Chart === "undefined" ||
      typeof BetterWeatherGrid === "undefined" ||
      typeof BetterWeatherChartPlugins === "undefined"
    ) {
      showStatus("Chart scripts failed to load.", "error");
      return false;
    }

    var tz = (pointsData.properties && pointsData.properties.timeZone) || "UTC";
    var coords = pointsData.geometry && pointsData.geometry.coordinates;
    var lon = coords ? coords[0] : 0;
    var lat = coords ? coords[1] : 0;
    var hourStarts = timeline.hourStarts;

    if (!hourStarts.length) {
      showStatus("No hourly grid data returned for this location.", "error");
      return false;
    }

    var n = hourStarts.length;
    var stackedEl = $("stacked-charts");
    if (stackedEl) {
      stackedEl.style.setProperty(
        "--chart-plot-min-width",
        Math.max(1, n) * PX_PER_CHART_HOUR + "px"
      );
    }

    var tickPlan = buildXTickPlan(hourStarts, tz, n);
    var labels = tickPlan.labels;
    var xPadBottom = tickPlan.bottomPad;

    var reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var dayNight = BetterWeatherChartPlugins.createDayNightBackgroundPlugin(
      hourStarts,
      lat,
      lon
    );
    var dateStrip = BetterWeatherChartPlugins.createDateStripPlugin(hourStarts, tz);

    var showA =
      hasNumericSeries(timeline.temperatureF) ||
      hasNumericSeries(timeline.dewpointF) ||
      hasNumericSeries(timeline.windChillF);
    var showB =
      hasNumericSeries(timeline.windMph) || hasNumericSeries(timeline.gustMph);
    var showC =
      hasNumericSeries(timeline.relativeHumidity) ||
      hasNumericSeries(timeline.pop) ||
      hasNumericSeries(timeline.skyCover);
    var wx = timeline.weather || [];
    var rainVals = wx.map(function (w) {
      return w.rain;
    });
    var qpfIn = timeline.quantitativePrecipitationInches || [];
    var hasQpf = hasNumericSeries(qpfIn);
    var showD =
      hasWeatherSeries(wx) ||
      hasNumericSeries(timeline.thunderPct) ||
      hasNumericSeries(rainVals) ||
      hasQpf;
    var showE = wx.some(function (w) {
      return w.snow || w.freezingRain || w.sleet;
    });

    var xTicksE = true;
    var xTicksD = true;
    var xTicksC = true;
    var xTicksB = true;
    var xTicksA = true;

    setWrapVisible("wrap-panel-a", showA);
    setWrapVisible("wrap-panel-b", showB);
    setWrapVisible("wrap-panel-c", showC);
    setWrapVisible("wrap-panel-d", showD);
    setWrapVisible("wrap-panel-e", showE);

    if (!showA && !showB && !showC && !showD && !showE) {
      showStatus("Grid forecast has no plottable data.", "error");
      return false;
    }

    var emptyLabels = new Array(n);
    for (var z = 0; z < n; z++) emptyLabels[z] = "";

    var pointStrideH = n > 144 ? 6 : 3;
    var pointValueLabels = makePointValueLabelsPlugin(pointStrideH);
    function prInterval(ctx) {
      return ctx.dataIndex % pointStrideH === 0 ? 3.25 : 0;
    }
    function prHover(ctx) {
      return ctx.dataIndex % pointStrideH === 0 ? 6 : 4;
    }

    function pushChart(canvasId, config) {
      var canvas = $(canvasId);
      var panelWrap =
        canvas && canvas.closest ? canvas.closest(".stacked-charts__panel") : null;
      if (!canvas || (panelWrap && panelWrap.hidden)) return;
      var ctx = canvas.getContext("2d");
      gridCharts.push(new Chart(ctx, config));
    }

    if (showA) {
      var datasetsA = [
        {
          label: "Temperature",
          data: timeline.temperatureF,
          borderColor: "rgb(248, 113, 113)",
          backgroundColor: "transparent",
          tension: 0.2,
          pointRadius: prInterval,
          pointHoverRadius: prHover,
          spanGaps: true,
        },
        {
          label: "Dewpoint",
          data: timeline.dewpointF,
          borderColor: "rgb(74, 222, 128)",
          backgroundColor: "transparent",
          tension: 0.2,
          pointRadius: prInterval,
          pointHoverRadius: prHover,
          spanGaps: true,
        },
        {
          label: "Wind chill",
          data: timeline.windChillF,
          borderColor: "rgb(96, 165, 250)",
          backgroundColor: "transparent",
          tension: 0.2,
          pointRadius: prInterval,
          pointHoverRadius: prHover,
          spanGaps: true,
        },
      ];
      fillHtmlLegend("legend-panel-a", datasetsA);
      pushChart("chart-panel-a", {
        type: "line",
        data: {
          labels: emptyLabels,
          datasets: datasetsA,
        },
        plugins: [dayNight, dateStrip, pointValueLabels],
        options: {
          animation: reduceMotion ? false : undefined,
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { top: 26, left: 4, right: 8, bottom: xPadBottom } },
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: chartLegendHidden(),
          },
          scales: {
            x: xScaleConfig(labels, xTicksA, tickPlan),
            y: {
              title: Object.assign({ display: true, text: "°F" }, chartTextDefaults()),
              ticks: chartTextDefaults(),
              grid: yGridLight(),
            },
          },
        },
      });
    }

    if (showB) {
      var windDir = timeline.windDirectionDeg || [];
      var hasWindDir = hasNumericSeries(windDir);
      var windVec =
        hasWindDir && typeof BetterWeatherChartPlugins.createWindVectorPlugin === "function"
          ? BetterWeatherChartPlugins.createWindVectorPlugin(
              hourStarts,
              windDir,
              timeline.windMph,
              0
            )
          : null;
      var windYMax = windAxisMaxMph(timeline.windMph, timeline.gustMph);

      var datasetsB = [
        {
          label: "Wind speed",
          data: timeline.windMph,
          borderColor: "rgb(192, 132, 252)",
          tension: 0.2,
          pointRadius: prInterval,
          pointHoverRadius: prHover,
          spanGaps: true,
        },
        {
          label: "Wind gust",
          data: timeline.gustMph,
          borderColor: "rgb(129, 140, 248)",
          tension: 0.2,
          pointRadius: prInterval,
          pointHoverRadius: prHover,
          spanGaps: true,
        },
      ];
      fillHtmlLegend("legend-panel-b", datasetsB);
      var pluginsB = [dayNight, dateStrip];
      if (windVec) pluginsB.push(windVec);
      pluginsB.push(pointValueLabels);
      pushChart("chart-panel-b", {
        type: "line",
        data: {
          labels: emptyLabels,
          datasets: datasetsB,
        },
        plugins: pluginsB,
        options: {
          animation: reduceMotion ? false : undefined,
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { top: 26, left: 4, right: 8, bottom: xPadBottom } },
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: chartLegendHidden(),
          },
          scales: {
            x: xScaleConfig(labels, xTicksB, tickPlan),
            y: {
              min: 0,
              max: windYMax,
              title: Object.assign({ display: true, text: "mph" }, chartTextDefaults()),
              ticks: Object.assign({ stepSize: 5 }, chartTextDefaults()),
              beginAtZero: true,
              grid: yGridLight(),
            },
          },
        },
      });
    }

    if (showC) {
      var datasetsC = [
        {
          label: "Relative humidity",
          data: timeline.relativeHumidity,
          borderColor: "rgb(74, 222, 128)",
          tension: 0.2,
          pointRadius: prInterval,
          pointHoverRadius: prHover,
          spanGaps: true,
        },
        {
          label: "Precip chance",
          data: timeline.pop,
          borderColor: "rgb(251, 191, 36)",
          stepped: true,
          pointRadius: prInterval,
          pointHoverRadius: prHover,
          spanGaps: true,
        },
        {
          label: "Sky cover",
          data: timeline.skyCover,
          borderColor: "rgb(56, 189, 248)",
          tension: 0.15,
          pointRadius: prInterval,
          pointHoverRadius: prHover,
          spanGaps: true,
        },
      ];
      fillHtmlLegend("legend-panel-c", datasetsC);
      pushChart("chart-panel-c", {
        type: "line",
        data: {
          labels: emptyLabels,
          datasets: datasetsC,
        },
        plugins: [dayNight, dateStrip, pointValueLabels],
        options: {
          animation: reduceMotion ? false : undefined,
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { top: 26, left: 4, right: 8, bottom: xPadBottom } },
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: chartLegendHidden(),
          },
          scales: {
            x: xScaleConfig(labels, xTicksC, tickPlan),
            y: {
              min: 0,
              max: 100,
              title: Object.assign({ display: true, text: "%" }, chartTextDefaults()),
              ticks: chartTextDefaults(),
              grid: yGridLight(),
            },
          },
        },
      });
    }

    if (showD) {
      var rainData = wx.map(function (w) {
        return w.rain;
      });
      var thunderLine = thunderDisplay(wx, timeline.thunderPct);
      var hasThunderLine = hasNumericSeries(thunderLine);
      var labelD = $("label-panel-d");
      var datasetsD;
      var scalesD;

      if (hasQpf) {
        if (labelD) {
          labelD.textContent = hasThunderLine
            ? "Rain amount & thunder"
            : "Rain amount (NWS grid)";
        }
        var qpfMax = seriesPositiveMax(qpfIn);
        var qpfSuggested = qpfMax > 0 ? Math.max(qpfMax * 1.12, 0.02) : 0.05;
        var qpfTicks = Object.assign(
          {
            callback: function (val) {
              var v = Number(val);
              if (isNaN(v)) return "";
              if (v === 0) return "0";
              if (v < 0.01) return v.toFixed(3);
              if (v < 0.1) return v.toFixed(2);
              return v.toFixed(2);
            },
          },
          chartTextDefaults()
        );
        datasetsD = [
          {
            label: "Rain amount (in)",
            data: qpfIn,
            borderColor: "rgb(96, 165, 250)",
            backgroundColor: "rgba(96, 165, 250, 0.12)",
            tension: 0.12,
            fill: false,
            stepped: "before",
            pointRadius: prInterval,
            pointHoverRadius: prHover,
            yAxisID: "y",
            spanGaps: true,
          },
        ];
        scalesD = {
          x: xScaleConfig(labels, xTicksD, tickPlan),
          y: {
            type: "linear",
            position: "left",
            min: 0,
            suggestedMax: qpfSuggested,
            title: Object.assign(
              { display: true, text: "Amount (in)" },
              chartTextDefaults()
            ),
            ticks: qpfTicks,
            grid: yGridLight(),
          },
        };
        if (hasThunderLine) {
          datasetsD.push({
            label: "Thunder (%)",
            data: thunderLine,
            borderColor: "rgb(248, 113, 113)",
            tension: 0.15,
            pointRadius: prInterval,
            pointHoverRadius: prHover,
            yAxisID: "y1",
            spanGaps: true,
          });
          scalesD.y1 = {
            type: "linear",
            position: "right",
            min: 0,
            max: 100,
            title: Object.assign(
              { display: true, text: "% thunder" },
              chartTextDefaults()
            ),
            ticks: chartTextDefaults(),
            grid: { drawOnChartArea: false },
          };
        }
      } else {
        if (labelD) {
          labelD.textContent = "Rain & thunder (coverage)";
        }
        datasetsD = [
          {
            label: "Rain (coverage)",
            data: rainData,
            borderColor: "rgb(74, 222, 128)",
            stepped: "before",
            pointRadius: prInterval,
            pointHoverRadius: prHover,
            yAxisID: "y",
            spanGaps: true,
          },
        ];
        if (hasThunderLine) {
          datasetsD.push({
            label: "Thunder (%)",
            data: thunderLine,
            borderColor: "rgb(248, 113, 113)",
            tension: 0.15,
            pointRadius: prInterval,
            pointHoverRadius: prHover,
            yAxisID: "y1",
            spanGaps: true,
          });
        }
        scalesD = {
          x: xScaleConfig(labels, xTicksD, tickPlan),
          y: {
            type: "linear",
            position: "left",
            min: 0,
            max: 4,
            title: Object.assign(
              { display: true, text: "Rain likelihood" },
              chartTextDefaults()
            ),
            ticks: Object.assign(
              {
                stepSize: 1,
                callback: ordinalTickCallback,
              },
              chartTextDefaults()
            ),
            grid: yGridLight(),
          },
        };
        if (hasThunderLine) {
          scalesD.y1 = {
            type: "linear",
            position: "right",
            min: 0,
            max: 100,
            title: Object.assign(
              { display: true, text: "% thunder" },
              chartTextDefaults()
            ),
            ticks: chartTextDefaults(),
            grid: { drawOnChartArea: false },
          };
        }
      }

      fillHtmlLegend("legend-panel-d", datasetsD);
      pushChart("chart-panel-d", {
        type: "line",
        data: {
          labels: emptyLabels,
          datasets: datasetsD,
        },
        plugins: [dayNight, dateStrip, pointValueLabels],
        options: {
          animation: reduceMotion ? false : undefined,
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { top: 26, left: 4, right: 8, bottom: xPadBottom } },
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: chartLegendHidden(),
          },
          scales: scalesD,
        },
      });
    }

    if (showE) {
      var datasetsE = [
        {
          label: "Snow",
          data: wx.map(function (w) {
            return w.snow;
          }),
          borderColor: "rgb(125, 211, 252)",
          stepped: "before",
          pointRadius: prInterval,
          pointHoverRadius: prHover,
          spanGaps: true,
        },
        {
          label: "Freezing rain",
          data: wx.map(function (w) {
            return w.freezingRain;
          }),
          borderColor: "rgb(216, 180, 254)",
          stepped: "before",
          pointRadius: prInterval,
          pointHoverRadius: prHover,
          spanGaps: true,
        },
        {
          label: "Sleet",
          data: wx.map(function (w) {
            return w.sleet;
          }),
          borderColor: "rgb(251, 146, 60)",
          stepped: "before",
          pointRadius: prInterval,
          pointHoverRadius: prHover,
          spanGaps: true,
        },
      ];
      fillHtmlLegend("legend-panel-e", datasetsE);
      pushChart("chart-panel-e", {
        type: "line",
        data: {
          labels: emptyLabels,
          datasets: datasetsE,
        },
        plugins: [dayNight, dateStrip, pointValueLabels],
        options: {
          animation: reduceMotion ? false : undefined,
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { top: 26, left: 4, right: 8, bottom: Math.max(4, xPadBottom) } },
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: chartLegendHidden(),
          },
          scales: {
            x: xScaleConfig(labels, xTicksE, tickPlan),
            y: {
              type: "linear",
              min: 0,
              max: 4,
              title: Object.assign({ display: true, text: "Coverage" }, chartTextDefaults()),
              ticks: Object.assign(
                {
                  stepSize: 1,
                  callback: ordinalTickCallback,
                },
                chartTextDefaults()
              ),
              grid: yGridLight(),
            },
          },
        },
      });
    }

    return gridCharts.length > 0;
  }

  var WX_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">';
  var WEATHER_ICON_HTML = {
    default: WX_SVG + "<path d=\"M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z\"/></svg>",
    clear:
      WX_SVG +
      "<circle cx=\"12\" cy=\"12\" r=\"3.5\"/><path d=\"M12 1.5V4M12 20v2.5M4.5 4.5l1.75 1.75M17.75 17.75l1.75 1.75M1.5 12H4M20 12h2.5M6.25 17.75l-1.75 1.75M19.5 5.5l-1.75 1.75\"/></svg>",
    clearNight:
      WX_SVG +
      "<path d=\"M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z\"/></svg>",
    partly:
      WX_SVG +
      "<path d=\"M18 11h-1.2a5 5 0 0 0-9.7 1.5A4 4 0 0 0 8 19h10a3 3 0 0 0 .1-6z\"/><path d=\"M12 2v1.5M9 4.5l1 .75M15 4.5l-1 .75\"/></svg>",
    cloudy:
      WX_SVG + "<path d=\"M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z\"/></svg>",
    fog:
      WX_SVG +
      "<path d=\"M4 14h16M4 18h12M6 10h10\" opacity=\".85\"/></svg>",
    rain:
      WX_SVG +
      "<path d=\"M16 13h1.2a4 4 0 0 0 .1-8 6 6 0 0 0-11.7 2A4 4 0 0 0 8 17h2\"/><path d=\"M11 18v3M8 19v2M14 19v2\"/></svg>",
    drizzle:
      WX_SVG +
      "<path d=\"M17 12h.8a3 3 0 0 0 .1-6 5 5 0 0 0-9.8 1.5A3 3 0 0 0 9 16h1.5\"/><path d=\"M10 17v1.5M12.5 17.5v1.5M15 17v1.5\"/></svg>",
    snow:
      WX_SVG +
      "<path d=\"M16 12h1.2a4 4 0 0 0 .1-8 6 6 0 0 0-11.7 2A4 4 0 0 0 8 16h1\"/><path d=\"M12 17v3.5M9.8 18.8l4.4 2.2M14.2 18.8l-4.4 2.2\"/></svg>",
    mix:
      WX_SVG +
      "<path d=\"M16 12h1.2a4 4 0 0 0 .1-8 6 6 0 0 0-11.4 1.8A4 4 0 0 0 8 16h2\"/><path d=\"M11 17v2.5M13.5 18l-1 1.7\"/></svg>",
    thunder:
      WX_SVG +
      "<path d=\"M16 11h1.2a4 4 0 0 0 .1-8 6 6 0 0 0-11.7 2A4 4 0 0 0 8 15h3l-2 4h4l-2.5 5\"/></svg>",
    wind:
      WX_SVG +
      "<path d=\"M3 8h8a3 3 0 1 0-3-3M5 12h11a3 3 0 1 1-3 3M7 16h6\"/></svg>",
    cold:
      WX_SVG +
      "<path d=\"M14 3v10.5a4 4 0 1 1-4 0V3\"/><path d=\"M10 7h4M10 10h4\"/></svg>",
    hot:
      WX_SVG +
      "<path d=\"M14 3v10.5a4 4 0 1 1-4 0V3\"/><path d=\"M10 5h4M10 8h4M10 11h4\"/></svg>",
  };

  function classifyPeriodWeatherIcon(p) {
    var t = (
      (p.shortForecast || "") +
      " " +
      (p.detailedForecast || "") +
      " " +
      (p.name || "")
    ).toLowerCase();
    var temp = typeof p.temperature === "number" ? p.temperature : null;
    var unit = (p.temperatureUnit || "F").toUpperCase();
    var tempF = temp != null ? (unit === "C" ? (temp * 9) / 5 + 32 : temp) : null;

    if (/thunder|tstm|lightning/.test(t)) return "thunder";
    if (/blizzard|heavy snow/.test(t)) return "snow";
    if (/freezing rain|ice pellets/.test(t)) return "mix";
    if (/sleet|wintry mix|mixed precip/.test(t)) return "mix";
    if (/snow|flurries/.test(t)) return "snow";
    if (/drizzle/.test(t)) return "drizzle";
    if (/shower|rain|precip|wet/.test(t)) return "rain";
    if (/fog|mist/.test(t)) return "fog";
    if (/wind|breezy|blowing/.test(t)) return "wind";
    if (/cloudy|overcast/.test(t)) return "cloudy";
    if (/mostly cloudy|partly|some sun|few clouds|scattered/.test(t)) return "partly";
    if (/clear|sunny|fair/.test(t)) return p.isDaytime === false ? "clearNight" : "clear";
    if (/cold|frigid/.test(t) || (tempF != null && tempF < 28)) return "cold";
    if (/hot|heat/.test(t) || (tempF != null && tempF > 88)) return "hot";
    return "default";
  }

  function periodWeatherIconSvg(p) {
    var k = classifyPeriodWeatherIcon(p);
    return WEATHER_ICON_HTML[k] || WEATHER_ICON_HTML.default;
  }

  function setLocationUiCompact(isCompact) {
    var hero = $("section-location-hero");
    var bar = $("site-location-bar");
    if (hero) hero.hidden = !!isCompact;
    if (bar) bar.hidden = !isCompact;
  }

  function renderPeriodCards(container, forecastGeo) {
    container.innerHTML = "";
    var props = forecastGeo.properties || {};
    var periods = props.periods || [];
    for (var i = 0; i < periods.length; i++) {
      var p = periods[i];
      var card = document.createElement("article");
      card.className = "period-card";
      if (p.isDaytime === true) {
        card.classList.add("period-card--day");
      } else if (p.isDaytime === false) {
        card.classList.add("period-card--night");
      } else {
        var nm = (p.name || "").toLowerCase();
        card.classList.add(nm.indexOf("night") >= 0 ? "period-card--night" : "period-card--day");
      }
      card.setAttribute("role", "listitem");

      var head = document.createElement("div");
      head.className = "period-card__head";

      var iconWrap = document.createElement("span");
      iconWrap.className = "period-card__icon-wrap";
      iconWrap.setAttribute("aria-hidden", "true");
      iconWrap.innerHTML = periodWeatherIconSvg(p);
      head.appendChild(iconWrap);

      var headText = document.createElement("div");
      headText.className = "period-card__head-text";

      var name = document.createElement("p");
      name.className = "period-card__name";
      name.textContent = p.name || "Period";

      var tempRow = document.createElement("div");
      tempRow.className = "period-card__temp-row";
      var temp = document.createElement("p");
      temp.className = "period-card__temp";
      var unit = p.temperatureUnit || "F";
      temp.textContent =
        typeof p.temperature === "number"
          ? p.temperature + "°" + unit
          : "—";
      tempRow.appendChild(temp);

      headText.appendChild(name);
      headText.appendChild(tempRow);
      head.appendChild(headText);
      card.appendChild(head);

      var short = document.createElement("p");
      short.className = "period-card__short";
      short.textContent = p.shortForecast || p.detailedForecast || "";

      card.appendChild(short);
      container.appendChild(card);
    }
  }

  function updateLocationReadout(pointsData) {
    var props = pointsData.properties || {};
    var rel = props.relativeLocation;
    var city = "";
    var state = "";
    if (rel && rel.properties) {
      city = rel.properties.city || "";
      state = rel.properties.state || "";
    }
    var grid = props.gridId || "";
    var line = "";
    if (city || state) line = city + (city && state ? ", " : "") + state;
    if (grid) line = (line ? line + " · " : "") + "Grid " + grid;
    if (!line) line = "Forecast loaded";
    var el = $("location-summary");
    if (el) el.textContent = line;
    var heroRead = $("location-readout-hero");
    if (heroRead) heroRead.textContent = line;
  }

  function showSections(show) {
    var chart = $("section-chart");
    var periods = $("section-periods");
    if (chart) chart.hidden = !show;
    if (periods) periods.hidden = !show;
  }

  function hideSections() {
    showSections(false);
  }

  function setChartLoadingUi(loading) {
    var secChart = $("section-chart");
    var skel = $("chart-skeleton");
    var well = $("chart-well");
    if (loading) {
      if (secChart) secChart.hidden = false;
      if (skel) skel.hidden = false;
      if (well) well.hidden = true;
    } else {
      if (skel) skel.hidden = true;
    }
  }

  function loadForecast(lat, lon) {
    lat = roundCoord(lat);
    lon = roundCoord(lon);

    var sLat = String(lat);
    var sLon = String(lon);
    var coordIds = ["input-lat", "input-lon", "input-lat-hero", "input-lon-hero"];
    var coordVals = [sLat, sLon, sLat, sLon];
    for (var ci = 0; ci < coordIds.length; ci++) {
      var inp = $(coordIds[ci]);
      if (inp) inp.value = coordVals[ci];
    }

    var mainEl = $("main");
    if (mainEl) mainEl.setAttribute("aria-busy", "true");

    setLoading(true);
    showStatus("Loading forecast…", "loading");
    destroyGridCharts();
    var secPeriods = $("section-periods");
    if (secPeriods) secPeriods.hidden = true;
    setChartLoadingUi(true);

    return apiPoints(lat, lon)
      .then(function (pointsData) {
        updateLocationReadout(pointsData);
        var props = pointsData.properties || {};
        var gridUrl = props.forecastGridData;
        var forecastUrl = props.forecast;
        if (!gridUrl || !forecastUrl) {
          throw new Error("Missing forecastGridData or forecast URL in NWS response");
        }
        return Promise.all([apiNws(gridUrl), apiNws(forecastUrl), pointsData]);
      })
      .then(function (results) {
        tryCloseLocationDialog();

        var gridGeo = results[0];
        var forecastGeo = results[1];
        var pointsData = results[2];

        var timeline = BetterWeatherGrid.buildHourlyTimeline(gridGeo);

        var well = $("chart-well");
        if (well) well.hidden = false;
        setChartLoadingUi(false);

        var chartsOk = buildGridCharts(pointsData, timeline);

        var sub = $("chart-subtitle");
        if (sub) {
          var u = timeline.updateTime || pointsData.properties.updateTime;
          sub.textContent = u
            ? "Forecast updated " + formatShortTime(u)
            : "From NWS forecastGridData";
        }

        renderPeriodCards($("period-strip"), forecastGeo);

        var secChart = $("section-chart");
        if (secChart) secChart.hidden = !chartsOk;
        if (secPeriods) secPeriods.hidden = false;

        setLocationUiCompact(true);

        if (chartsOk) {
          hideStatus();
        } else {
          destroyGridCharts();
          if (well) well.hidden = true;
        }
      })
      .catch(function (err) {
        console.error(err);
        tryCloseLocationDialog();
        destroyGridCharts();
        setChartLoadingUi(false);
        var well = $("chart-well");
        if (well) well.hidden = true;
        showSections(false);
        showStatus(err.message || "Something went wrong.", "error");
      })
      .finally(function () {
        setLoading(false);
        if (mainEl) mainEl.setAttribute("aria-busy", "false");
      });
  }

  function onGeolocate() {
    if (!navigator.geolocation) {
      showStatus("Geolocation is not supported in this browser.", "error");
      return;
    }
    setLoading(true);
    showStatus("Getting location…", "loading");
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        loadForecast(pos.coords.latitude, pos.coords.longitude);
      },
      function () {
        setLoading(false);
        showStatus(
          "Could not get location. Enter coordinates or check permissions.",
          "error"
        );
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 }
    );
  }

  function onSubmitCoords(e) {
    e.preventDefault();
    var form = e.currentTarget;
    var latEl = form.querySelector('[name="lat"]');
    var lonEl = form.querySelector('[name="lon"]');
    if (!latEl || !lonEl) return;
    var lat = parseFloat(latEl.value);
    var lon = parseFloat(lonEl.value);
    if (isNaN(lat) || isNaN(lon)) {
      showStatus("Enter valid latitude and longitude numbers.", "error");
      return;
    }
    loadForecast(lat, lon);
  }

  function init() {
    var btn = $("btn-geolocate");
    var form = $("form-coords");
    if (btn) btn.addEventListener("click", onGeolocate);
    if (form) form.addEventListener("submit", onSubmitCoords);

    var btnHero = $("btn-geolocate-hero");
    var formHero = $("form-coords-hero");
    if (btnHero) btnHero.addEventListener("click", onGeolocate);
    if (formHero) formHero.addEventListener("submit", onSubmitCoords);

    var dlg = $("location-dialog");
    var changeBtn = $("btn-change-location");
    if (changeBtn && dlg && typeof dlg.showModal === "function") {
      changeBtn.addEventListener("click", function () {
        dlg.showModal();
        var lat = $("input-lat");
        if (lat) lat.focus();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
