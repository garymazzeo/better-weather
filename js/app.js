/**
 * Better Weather — NWS via PHP proxy, Chart.js hourly chart + period cards.
 */

(function () {
  "use strict";

  var chartInstance = null;

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

  function destroyChart() {
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
  }

  function buildHourlyChart(canvas, hourlyGeo) {
    var props = hourlyGeo.properties || {};
    var periods = props.periods || [];
    if (!periods.length) return;

    var labels = [];
    var temps = [];
    var precips = [];

    for (var i = 0; i < periods.length; i++) {
      var p = periods[i];
      labels.push(formatShortTime(p.startTime));
      var t = p.temperature;
      temps.push(typeof t === "number" ? t : null);
      var pop = p.probabilityOfPrecipitation;
      var pv = pop && typeof pop.value === "number" ? pop.value : null;
      precips.push(pv);
    }

    var ctx = canvas.getContext("2d");
    destroyChart();

    var reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    chartInstance = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            type: "line",
            label: "Temperature (°" + (props.periods[0].temperatureUnit || "F") + ")",
            data: temps,
            borderColor: "rgb(56, 189, 248)",
            backgroundColor: "rgba(56, 189, 248, 0.12)",
            fill: true,
            tension: 0.25,
            pointRadius: 0,
            pointHoverRadius: 4,
            yAxisID: "y",
            spanGaps: true,
          },
          {
            type: "bar",
            label: "Precip chance (%)",
            data: precips,
            backgroundColor: "rgba(148, 163, 184, 0.35)",
            yAxisID: "y1",
            maxBarThickness: 8,
          },
        ],
      },
      options: {
        animation: reduceMotion ? false : undefined,
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            labels: { color: "#e8edf4" },
          },
          tooltip: {
            callbacks: {
              title: function (items) {
                var idx = items[0].dataIndex;
                return periods[idx] && periods[idx].startTime
                  ? formatShortTime(periods[idx].startTime)
                  : "";
              },
              afterBody: function (items) {
                var idx = items[0].dataIndex;
                var p = periods[idx];
                if (!p) return;
                var lines = [];
                if (p.shortForecast) lines.push(p.shortForecast);
                if (p.windSpeed) lines.push("Wind: " + p.windSpeed);
                return lines;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: "#94a3b8",
              maxRotation: 45,
              minRotation: 45,
              autoSkip: true,
              maxTicksLimit: 18,
            },
            grid: { color: "rgba(255,255,255,0.06)" },
          },
          y: {
            position: "left",
            title: { display: true, text: "°F", color: "#94a3b8" },
            ticks: { color: "#94a3b8" },
            grid: { color: "rgba(255,255,255,0.06)" },
          },
          y1: {
            position: "right",
            min: 0,
            max: 100,
            title: { display: true, text: "%", color: "#94a3b8" },
            ticks: { color: "#94a3b8" },
            grid: { drawOnChartArea: false },
          },
        },
      },
    });
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
        var hourlyUrl = props.forecastHourly;
        var forecastUrl = props.forecast;
        if (!hourlyUrl || !forecastUrl) {
          throw new Error("Missing forecast URLs in NWS response");
        }
        return Promise.all([apiNws(hourlyUrl), apiNws(forecastUrl), pointsData]);
      })
      .then(function (results) {
        var hourlyGeo = results[0];
        var forecastGeo = results[1];
        var pointsData = results[2];

        var canvas = $("chart-hourly");
        if (canvas && typeof Chart !== "undefined") {
          buildHourlyChart(canvas, hourlyGeo);
        }

        var sub = $("chart-subtitle");
        if (sub) {
          var u = pointsData.properties && pointsData.properties.updateTime;
          sub.textContent = u
            ? "Updated " + formatShortTime(u)
            : "Hourly forecast";
        }

        renderPeriodCards($("period-strip"), forecastGeo);
        showSections(true);
        hideStatus();
      })
      .catch(function (err) {
        console.error(err);
        destroyChart();
        showSections(false);
        showStatus(err.message || "Something went wrong.", "error");
      })
      .finally(function () {
        setLoading(false);
        if (mainEl) mainEl.setAttribute("aria-busy", "false");
      });
  }

  function hideSections() {
    showSections(false);
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
