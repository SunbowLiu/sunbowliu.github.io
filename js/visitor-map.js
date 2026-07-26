(function () {
    "use strict";

    var CONFIG = {
        // Create a Supabase table named visitor_locations, then fill these.
        supabaseUrl: "https://keslfepmzbfhhcgedrab.supabase.co",
        supabaseAnonKey: "sb_publishable_2ASC5HDirsjL0Lca-pAvTg_80cltq2l",
        table: "visitor_locations",
        pageSize: 1000,
        maxPages: 20,
        worldAtlasUrls: [
            "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json",
            "https://fastly.jsdelivr.net/npm/world-atlas@2/countries-110m.json",
            "https://unpkg.com/world-atlas@2/countries-110m.json"
        ],
        geoUrl: "https://ipapi.co/json/",
        requestTimeoutMs: 6000
    };

    if (window.VISITOR_MAP_CONFIG) {
        Object.keys(window.VISITOR_MAP_CONFIG).forEach(function (key) {
            CONFIG[key] = window.VISITOR_MAP_CONFIG[key];
        });
    }

    var supabaseEnabled = Boolean(
        CONFIG.supabaseUrl &&
        CONFIG.supabaseAnonKey &&
        CONFIG.supabaseUrl.indexOf("https://") === 0
    );
    var worldPromise = null;

    function supabaseHeaders(extra) {
        var base = {
            "apikey": CONFIG.supabaseAnonKey,
            "Authorization": "Bearer " + CONFIG.supabaseAnonKey,
            "Content-Type": "application/json"
        };
        Object.keys(extra || {}).forEach(function (key) {
            base[key] = extra[key];
        });
        return base;
    }

    function fetchWithTimeout(url, options) {
        var timeoutId = null;
        var requestOptions = options || {};

        if (window.AbortController) {
            var controller = new AbortController();
            requestOptions.signal = controller.signal;
            timeoutId = window.setTimeout(function () {
                controller.abort();
            }, CONFIG.requestTimeoutMs);
        }

        return fetch(url, requestOptions)
            .then(function (response) {
                if (timeoutId) {
                    window.clearTimeout(timeoutId);
                }
                return response;
            })
            .catch(function (error) {
                if (timeoutId) {
                    window.clearTimeout(timeoutId);
                }
                throw error;
            });
    }

    function fetchJson(url) {
        return fetchWithTimeout(url, { cache: "no-store" })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error(response.status + " " + response.statusText);
                }
                return response.json();
            });
    }

    function fetchVisitorsPage(from) {
        if (!supabaseEnabled) {
            return Promise.resolve({ total: 0, rows: [] });
        }

        var to = from + CONFIG.pageSize - 1;
        var endpoint = CONFIG.supabaseUrl.replace(/\/$/, "") +
            "/rest/v1/" + encodeURIComponent(CONFIG.table) +
            "?select=country,city,lat,lng,visited_at&order=visited_at.desc";

        return fetchWithTimeout(endpoint, {
            headers: supabaseHeaders({
                "Prefer": "count=exact",
                "Range-Unit": "items",
                "Range": from + "-" + to
            }),
            cache: "no-store"
        }).then(function (response) {
            if (!response.ok) {
                console.warn("[visitor-map] Supabase read failed:", response.status, response.statusText);
                return { total: 0, rows: [] };
            }

            var range = response.headers.get("content-range") || "*/0";
            var total = parseInt(range.split("/")[1], 10) || 0;

            return response.json().then(function (rows) {
                return {
                    total: total,
                    rows: Array.isArray(rows) ? rows : []
                };
            });
        }).catch(function (error) {
            console.warn("[visitor-map] Supabase read error:", error);
            return { total: 0, rows: [] };
        });
    }

    function loadVisitors() {
        var all = [];

        function next(from, page) {
            return fetchVisitorsPage(from).then(function (result) {
                all = all.concat(result.rows);

                if (
                    result.rows.length === CONFIG.pageSize &&
                    all.length < result.total &&
                    page + 1 < CONFIG.maxPages
                ) {
                    return next(from + CONFIG.pageSize, page + 1);
                }

                return {
                    total: result.total || all.length,
                    visitors: all
                };
            });
        }

        return next(0, 0);
    }

    function geolocate() {
        return fetchJson(CONFIG.geoUrl)
            .then(function (geo) {
                if (!geo || geo.latitude == null || geo.longitude == null) {
                    return null;
                }

                return {
                    lat: Number(geo.latitude),
                    lng: Number(geo.longitude),
                    country: geo.country_name || geo.country || "",
                    city: geo.city || ""
                };
            })
            .catch(function (error) {
                console.warn("[visitor-map] Geolocation failed:", error);
                return null;
            });
    }

    function recordVisit(me) {
        if (!supabaseEnabled || !me) {
            return Promise.resolve(false);
        }

        var endpoint = CONFIG.supabaseUrl.replace(/\/$/, "") +
            "/rest/v1/" + encodeURIComponent(CONFIG.table);

        return fetchWithTimeout(endpoint, {
            method: "POST",
            headers: supabaseHeaders({ "Prefer": "return=minimal" }),
            cache: "no-store",
            body: JSON.stringify(me)
        }).then(function (response) {
            if (!response.ok) {
                console.warn("[visitor-map] Supabase insert failed:", response.status, response.statusText);
                return false;
            }
            return true;
        }).catch(function (error) {
            console.warn("[visitor-map] Supabase insert error:", error);
            return false;
        });
    }

    function setCaption(root, total, hasMe) {
        var caption = root.querySelector(".visitor-map__caption");
        if (!caption) return;

        if (supabaseEnabled) {
            caption.textContent = (total + (hasMe ? 1 : 0)).toLocaleString() + " visits";
        } else if (hasMe) {
            caption.textContent = "Current visit";
        } else {
            caption.textContent = "Visitor map";
        }
    }

    function getWorld() {
        if (!worldPromise) {
            var urls = CONFIG.worldAtlasUrls || [CONFIG.worldAtlasUrl];
            worldPromise = urls.reduce(function (promise, url) {
                return promise.catch(function () {
                    return fetchJson(url);
                });
            }, Promise.reject());
        }
        return worldPromise;
    }

    function ageDays(visitor, now) {
        if (!visitor || !visitor.visited_at) return Infinity;
        var time = Date.parse(visitor.visited_at);
        if (isNaN(time)) return Infinity;
        return (now - time) / 86400000;
    }

    function relTime(days) {
        if (!isFinite(days)) return "";
        if (days < 1 / 24) return "just now";
        if (days < 1) return Math.max(1, Math.round(days * 24)) + "h ago";
        if (days < 30) return Math.round(days) + "d ago";
        if (days < 365) return Math.round(days / 30) + "mo ago";
        return Math.round(days / 365) + "y ago";
    }

    function styleFor(days) {
        if (days <= 2) return { r: 5.2, fill: "#2563eb", opacity: 0.95 };
        if (days <= 7) return { r: 4.7, fill: "#3b82f6", opacity: 0.86 };
        if (days <= 30) return { r: 4.1, fill: "#60a5fa", opacity: 0.74 };
        if (days <= 90) return { r: 3.6, fill: "#93c5fd", opacity: 0.6 };
        return { r: 3.2, fill: "#bfdbfe", opacity: 0.48 };
    }

    function drawMap(root, visitors, me) {
        var loading = root.querySelector(".visitor-map__loading");
        if (!window.d3 || !window.topojson) {
            loading.textContent = "Map unavailable.";
            return;
        }

        var canvas = root.querySelector(".visitor-map__canvas");
        var tooltip = root.querySelector(".visitor-map__tooltip");
        var width = Number(root.getAttribute("data-width")) || canvas.clientWidth || 240;
        var height = Math.round(width * 0.52);

        canvas.style.minHeight = height + "px";
        canvas.querySelectorAll("svg").forEach(function (node) {
            node.remove();
        });

        var svg = d3.select(canvas)
            .append("svg")
            .attr("viewBox", "0 0 " + width + " " + height)
            .attr("preserveAspectRatio", "xMidYMid meet");

        var projection = d3.geoNaturalEarth1()
            .scale(width / 6.2)
            .translate([width / 2, height / 2]);

        var path = d3.geoPath().projection(projection);

        svg.append("path")
            .datum(d3.geoGraticule()())
            .attr("fill", "none")
            .attr("stroke", "#b8c8da")
            .attr("stroke-width", 0.28)
            .attr("d", path);

        getWorld().then(function (world) {
            var features = topojson.feature(world, world.objects.countries).features;

            svg.selectAll(".land")
                .data(features)
                .join("path")
                .attr("class", "country-base")
                .attr("d", path);

            svg.append("path")
                .datum({ type: "Sphere" })
                .attr("fill", "none")
                .attr("stroke", "#9fb2c6")
                .attr("stroke-width", 0.7)
                .attr("d", path);

            drawDots(svg, projection, canvas, tooltip, visitors, me);

            if (loading) {
                loading.remove();
            }
        }).catch(function (error) {
            console.warn("[visitor-map] World map failed:", error);
            loading.textContent = "Map unavailable.";
        });
    }

    function drawDots(svg, projection, canvas, tooltip, visitors, me) {
        var now = Date.now();
        var drawable = visitors.filter(function (visitor) {
            return visitor && visitor.lat != null && visitor.lng != null;
        });

        drawable.forEach(function (visitor, index) {
            var days = ageDays(visitor, now);
            visitor.__halo = index < 5;
            visitor.__style = styleFor(days);
            visitor.__rel = relTime(days);
        });

        function addDot(visitor, isMe) {
            var xy = projection([Number(visitor.lng), Number(visitor.lat)]);
            if (!xy) return;

            if (isMe) {
                svg.append("circle")
                    .attr("class", "visitor-dot-ring")
                    .attr("cx", xy[0])
                    .attr("cy", xy[1])
                    .attr("r", 10);
            } else if (visitor.__halo) {
                svg.append("circle")
                    .attr("class", "recent-halo")
                    .attr("cx", xy[0])
                    .attr("cy", xy[1])
                    .attr("r", visitor.__style.r + 4);
            }

            var dot = svg.append("circle")
                .attr("cx", xy[0])
                .attr("cy", xy[1])
                .style("cursor", "pointer")
                .style("pointer-events", "all");

            if (isMe) {
                dot.attr("r", 5).attr("class", "you-are-here");
            } else {
                dot.attr("r", visitor.__style.r)
                    .attr("fill", visitor.__style.fill)
                    .attr("stroke", "#ffffff")
                    .attr("stroke-width", 0.9)
                    .attr("opacity", visitor.__style.opacity);
            }

            dot.on("mousemove", function (event) {
                var place = visitor.city ? visitor.city + ", " + visitor.country : visitor.country;
                var label = isMe ? "You: " + place : place;
                if (!isMe && visitor.__rel) {
                    label += " - " + visitor.__rel;
                }

                tooltip.textContent = label;
                tooltip.style.display = "block";

                var rect = canvas.getBoundingClientRect();
                tooltip.style.left = (event.clientX - rect.left + 10) + "px";
                tooltip.style.top = (event.clientY - rect.top - 24) + "px";
            }).on("mouseleave", function () {
                tooltip.style.display = "none";
            });
        }

        for (var i = drawable.length - 1; i >= 0; i--) {
            addDot(drawable[i], false);
        }

        if (me) {
            addDot(me, true);
        }
    }

    function initOne(root) {
        var width = Number(root.getAttribute("data-width")) || 240;
        root.style.setProperty("--visitor-map-width", width + "px");

        loadVisitors().then(function (result) {
            return geolocate().then(function (me) {
                setCaption(root, result.total, Boolean(me));
                recordVisit(me);
                drawMap(root, result.visitors, me);
            });
        });
    }

    document.addEventListener("DOMContentLoaded", function () {
        document.querySelectorAll(".visitor-map").forEach(initOne);
    });
}());
