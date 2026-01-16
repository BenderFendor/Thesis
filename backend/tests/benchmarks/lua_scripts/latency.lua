-- wrk2 Lua script for latency distribution measurement
-- Usage: wrk2 -s latency.lua -R<requests_per_second> -d<duration>s <url>

wrk.init = function(args)
    local idx = 0
    local latencies = {}
    
    -- Override wrk.done to output latency histogram
    wrk.done = function(summary)
        local encode = json.encode
        local format = string.format
        
        local report = {}
        report.duration = summary.duration / 1000000  -- convert to seconds
        report.requests = summary.requests
        report.bytes = summary.bytes
        report.errors = summary.errors
        
        -- Calculate latency percentiles
        local lat = {}
        for _, v in ipairs(summary.latency) do
            table.insert(lat, v)
        end
        table.sort(lat)
        
        local count = #lat
        if count > 0 then
            report.p50 = lat[math.floor(count * 0.50)]
            report.p75 = lat[math.floor(count * 0.75)]
            report.p90 = lat[math.floor(count * 0.90)]
            report.p95 = lat[math.floor(count * 0.95)]
            report.p99 = lat[math.floor(count * 0.99)]
            report.p999 = lat[math.floor(count * 0.999)]
        end
        
        io.write(encode(report) .. "\n")
    end
end

-- Generate request path dynamically
request = function()
    wrk.path = "/news/page?limit=50"
    wrk.headers["Accept"] = "application/json"
    return wrk.format()
end
