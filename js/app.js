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
    var btn = $("btn-geolocate");
    var form = $("form-coords");
    if (btn) btn.disabled = isLoading;
    if (form) {
      var inputs = form.querySelectorAll("button, input");
      for (var i = 0; i < inputs.length; i++) inputs[i].disabled = isLoading;
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

  function formatHourTick(ms, timeZone) {
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: timeZone || "UTC",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(ms));
    } catch (e) {
      return "";
    }
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

  function chartTextDefaults() {
    return {
      color: "#334155",
      font: { size: 11, family: 'system-ui, "Outfit", sans-serif' },
    };
  }

  function legendOpts() {
    var t = chartTextDefaults();
    return {
      position: "top",
      align: "end",
      labels: { color: t.color, font: t.font },
    };
  }

  function xScaleConfig(labels, showTickLabels) {
    return {
      ticks: Object.assign(
        {
          autoSkip: false,
          maxRotation: 0,
          color: "#64748b",
          callback: function (_val, idx) {
            return labels[idx] || "";
          },
        },
        showTickLabels ? {} : { display: false }
      ),
      grid: { color: "rgba(15, 23, 42, 0.1)" },
    };
  }

  function ordinalTickCallback(value) {
    var map = ["", "SChc", "Chc", "Lkly", "Ocnl"];
    var v = Math.round(Number(value));
    return map[v] || "";
  }

  function buildGridCharts(pointsData, timeline) {
    destroyGridCharts();

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
    var labels = [];
    for (var li = 0; li < n; li++) {
      labels.push(li % 3 === 0 ? formatHourTick(hourStarts[li], tz) : "");
    }

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
    var showD =
      hasWeatherSeries(wx) ||
      hasNumericSeries(timeline.thunderPct) ||
      hasNumericSeries(rainVals);
    var showE = wx.some(function (w) {
      return w.snow || w.freezingRain || w.sleet;
    });

    var xTicksE = showE;
    var xTicksD = showD && !showE;
    var xTicksC = showC && !showD && !showE;
    var xTicksB = showB && !showC && !showD && !showE;
    var xTicksA = showA && !showB && !showC && !showD && !showE;

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

    function pushChart(canvasId, config) {
      var canvas = $(canvasId);
      var panelWrap =
        canvas && canvas.closest ? canvas.closest(".stacked-charts__panel") : null;
      if (!canvas || (panelWrap && panelWrap.hidden)) return;
      var ctx = canvas.getContext("2d");
      gridCharts.push(new Chart(ctx, config));
    }

    if (showA) {
      pushChart("chart-panel-a", {
        type: "line",
        data: {
          labels: emptyLabels,
          datasets: [
            {
              label: "Temperature",
              data: timeline.temperatureF,
              borderColor: "rgb(220, 38, 38)",
              backgroundColor: "transparent",
              tension: 0.2,
              pointRadius: 2,
              spanGaps: true,
            },
            {
              label: "Dewpoint",
              data: timeline.dewpointF,
              borderColor: "rgb(22, 163, 74)",
              backgroundColor: "transparent",
              tension: 0.2,
              pointRadius: 2,
              spanGaps: true,
            },
            {
              label: "Wind chill",
              data: timeline.windChillF,
              borderColor: "rgb(37, 99, 235)",
              backgroundColor: "transparent",
              tension: 0.2,
              pointRadius: 2,
              spanGaps: true,
            },
          ],
        },
        plugins: [dayNight, dateStrip],
        options: {
          animation: reduceMotion ? false : undefined,
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { top: 26, left: 4, right: 8, bottom: 2 } },
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: legendOpts(),
          },
          scales: {
            x: xScaleConfig(labels, xTicksA),
            y: {
              title: Object.assign({ display: true, text: "°F" }, chartTextDefaults()),
              ticks: chartTextDefaults(),
              grid: { color: "rgba(15, 23, 42, 0.08)" },
            },
          },
        },
      });
    }

    if (showB) {
      pushChart("chart-panel-b", {
        type: "line",
        data: {
          labels: emptyLabels,
          datasets: [
            {
              label: "Wind speed",
              data: timeline.windMph,
              borderColor: "rgb(147, 51, 234)",
              tension: 0.2,
              pointRadius: 2,
              spanGaps: true,
            },
            {
              label: "Wind gust",
              data: timeline.gustMph,
              borderColor: "rgb(30, 64, 175)",
              tension: 0.2,
              pointRadius: 2,
              spanGaps: true,
            },
          ],
        },
        plugins: [dayNight],
        options: {
          animation: reduceMotion ? false : undefined,
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { top: 4, left: 4, right: 8, bottom: 2 } },
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: legendOpts(),
          },
          scales: {
            x: xScaleConfig(labels, xTicksB),
            y: {
              title: Object.assign({ display: true, text: "mph" }, chartTextDefaults()),
              ticks: chartTextDefaults(),
              beginAtZero: true,
              grid: { color: "rgba(15, 23, 42, 0.08)" },
            },
          },
        },
      });
    }

    if (showC) {
      pushChart("chart-panel-c", {
        type: "line",
        data: {
          labels: emptyLabels,
          datasets: [
            {
              label: "Relative humidity",
              data: timeline.relativeHumidity,
              borderColor: "rgb(22, 163, 74)",
              tension: 0.2,
              pointRadius: 2,
              spanGaps: true,
            },
            {
              label: "Precip chance",
              data: timeline.pop,
              borderColor: "rgb(120, 53, 15)",
              stepped: true,
              pointRadius: 0,
              spanGaps: true,
            },
            {
              label: "Sky cover",
              data: timeline.skyCover,
              borderColor: "rgb(37, 99, 235)",
              tension: 0.15,
              pointRadius: 0,
              spanGaps: true,
            },
          ],
        },
        plugins: [dayNight],
        options: {
          animation: reduceMotion ? false : undefined,
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { top: 4, left: 4, right: 8, bottom: 2 } },
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: legendOpts(),
          },
          scales: {
            x: xScaleConfig(labels, xTicksC),
            y: {
              min: 0,
              max: 100,
              title: Object.assign({ display: true, text: "%" }, chartTextDefaults()),
              ticks: chartTextDefaults(),
              grid: { color: "rgba(15, 23, 42, 0.08)" },
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
      pushChart("chart-panel-d", {
        type: "line",
        data: {
          labels: emptyLabels,
          datasets: [
            {
              label: "Rain (coverage)",
              data: rainData,
              borderColor: "rgb(22, 163, 74)",
              stepped: "before",
              pointRadius: 0,
              yAxisID: "y",
              spanGaps: true,
            },
            {
              label: "Thunder / prob",
              data: thunderLine,
              borderColor: "rgb(220, 38, 38)",
              tension: 0.15,
              pointRadius: 0,
              yAxisID: "y1",
              spanGaps: true,
            },
          ],
        },
        plugins: [dayNight],
        options: {
          animation: reduceMotion ? false : undefined,
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { top: 4, left: 4, right: 8, bottom: 2 } },
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: legendOpts(),
          },
          scales: {
            x: xScaleConfig(labels, xTicksD),
            y: {
              type: "linear",
              position: "left",
              min: 0,
              max: 4,
              title: Object.assign({ display: true, text: "Rain" }, chartTextDefaults()),
              ticks: Object.assign(
                {
                  stepSize: 1,
                  callback: ordinalTickCallback,
                },
                chartTextDefaults()
              ),
              grid: { color: "rgba(15, 23, 42, 0.08)" },
            },
            y1: {
              type: "linear",
              position: "right",
              min: 0,
              max: 100,
              title: Object.assign({ display: true, text: "% thunder" }, chartTextDefaults()),
              ticks: chartTextDefaults(),
              grid: { drawOnChartArea: false },
            },
          },
        },
      });
    }

    if (showE) {
      pushChart("chart-panel-e", {
        type: "line",
        data: {
          labels: emptyLabels,
          datasets: [
            {
              label: "Snow",
              data: wx.map(function (w) {
                return w.snow;
              }),
              borderColor: "rgb(56, 189, 248)",
              stepped: "before",
              pointRadius: 0,
              spanGaps: true,
            },
            {
              label: "Freezing rain",
              data: wx.map(function (w) {
                return w.freezingRain;
              }),
              borderColor: "rgb(147, 51, 234)",
              stepped: "before",
              pointRadius: 0,
              spanGaps: true,
            },
            {
              label: "Sleet",
              data: wx.map(function (w) {
                return w.sleet;
              }),
              borderColor: "rgb(234, 88, 12)",
              stepped: "before",
              pointRadius: 0,
              spanGaps: true,
            },
          ],
        },
        plugins: [dayNight],
        options: {
          animation: reduceMotion ? false : undefined,
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { top: 4, left: 4, right: 8, bottom: 4 } },
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: legendOpts(),
          },
          scales: {
            x: xScaleConfig(labels, xTicksE),
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
              grid: { color: "rgba(15, 23, 42, 0.08)" },
            },
          },
        },
      });
    }

    return gridCharts.length > 0;
  }

  function renderPeriodCards(container, forecastGeo) {
    container.innerHTML = "";
    var props = forecastGeo.properties || {};
    var periods = props.periods || [];
    for (var i = 0; i < periods.length; i++) {
      var p = periods[i];
      var card = document.createElement("article");
      card.className = "period-card";
      card.setAttribute("role", "listitem");

      var name = document.createElement("p");
      name.className = "period-card__name";
      name.textContent = p.name || "Period";

      var temp = document.createElement("p");
      temp.className = "period-card__temp";
      var unit = p.temperatureUnit || "F";
      temp.textContent =
        typeof p.temperature === "number"
          ? p.temperature + "°" + unit
          : "—";

      var short = document.createElement("p");
      short.className = "period-card__short";
      short.textContent = p.shortForecast || p.detailedForecast || "";

      card.appendChild(name);
      card.appendChild(temp);
      card.appendChild(short);
      container.appendChild(card);
    }
  }

  function updateLocationReadout(pointsData) {
    var el = $("location-readout");
    if (!el) return;
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
    el.textContent = line;
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

  function loadForecast(lat, lon) {
    lat = roundCoord(lat);
    lon = roundCoord(lon);

    $("input-lat").value = String(lat);
    $("input-lon").value = String(lon);

    var mainEl = $("main");
    if (mainEl) mainEl.setAttribute("aria-busy", "true");

    setLoading(true);
    showStatus("Loading forecast…", "loading");
    hideSections();

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
        var gridGeo = results[0];
        var forecastGeo = results[1];
        var pointsData = results[2];

        var timeline = BetterWeatherGrid.buildHourlyTimeline(gridGeo);
        var chartsOk = buildGridCharts(pointsData, timeline);

        var sub = $("chart-subtitle");
        if (sub) {
          var u = timeline.updateTime || pointsData.properties.updateTime;
          sub.textContent = u
            ? "Grid updated " + formatShortTime(u)
            : "From NWS forecastGridData";
        }

        renderPeriodCards($("period-strip"), forecastGeo);

        var secChart = $("section-chart");
        var secPeriods = $("section-periods");
        if (secChart) secChart.hidden = !chartsOk;
        if (secPeriods) secPeriods.hidden = false;

        if (chartsOk) {
          hideStatus();
        } else {
          destroyGridCharts();
        }
      })
      .catch(function (err) {
        console.error(err);
        destroyGridCharts();
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
    var latEl = $("input-lat");
    var lonEl = $("input-lon");
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
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
