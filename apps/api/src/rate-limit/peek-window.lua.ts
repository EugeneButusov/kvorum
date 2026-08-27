export const PEEK_WINDOW_LUA = String.raw`
-- Read-only variant of the sliding-window counter. Trims expired entries and returns current counts
-- for both windows WITHOUT adding a new member (no rate-limit token consumed).
--
-- KEYS:
--   1 minute window zset key
--   2 day window zset key
-- ARGV:
--   1 now_ms
--
-- Return: {minute_count, minute_reset_seconds, day_count, day_reset_seconds}

local now_ms = tonumber(ARGV[1])
local minute_ms = 60000
local day_ms = 86400000

local function peek(key, window_ms)
  redis.call('ZREMRANGEBYSCORE', key, '-inf', now_ms - window_ms)
  local count = tonumber(redis.call('ZCARD', key)) or 0

  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local reset_s
  if oldest[2] == nil then
    reset_s = 0
  else
    local delta_ms = (tonumber(oldest[2]) + window_ms) - now_ms
    if delta_ms < 1 then
      delta_ms = 1
    end
    reset_s = math.ceil(delta_ms / 1000)
  end

  return { count, reset_s }
end

local m = peek(KEYS[1], minute_ms)
local d = peek(KEYS[2], day_ms)
return { m[1], m[2], d[1], d[2] }
`;
