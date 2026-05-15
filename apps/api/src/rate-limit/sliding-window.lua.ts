export const SLIDING_WINDOW_LUA = String.raw`
-- True sliding-window counter for minute/day quotas using timestamped ZSETs.
-- Two-phase behavior is preserved: evaluate both windows first, write only if both allow.
--
-- KEYS:
--   1 minute window zset key
--   2 day window zset key
-- ARGV:
--   1 now_ms
--   2 minute_limit
--   3 day_limit
--   4 request_member (must be unique per request)
--
-- Return: {admit_all, minute_limit, remaining, reset_seconds, retry_after_seconds, binding_window}
--   admit path: remaining reflects post-increment minute count.
--   reject path: remaining=0 and no writes are performed.

local now_ms = tonumber(ARGV[1])
local minute_limit = tonumber(ARGV[2])
local day_limit = tonumber(ARGV[3])
local request_member = ARGV[4]

local minute_ms = 60000
local day_ms = 86400000

local function trim_and_count(key, window_ms)
  local cutoff = now_ms - window_ms
  redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)
  local count = tonumber(redis.call('ZCARD', key)) or 0

  return {
    count = count,
  }
end

local function seconds_until_oldest_expires(key, window_ms)
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  if oldest[2] == nil then
    return math.ceil(window_ms / 1000)
  end

  local oldest_score = tonumber(oldest[2])
  local delta_ms = (oldest_score + window_ms) - now_ms
  if delta_ms < 1 then
    delta_ms = 1
  end

  local delta_sec = math.ceil(delta_ms / 1000)
  if delta_sec < 1 then
    delta_sec = 1
  end
  return delta_sec
end

local minute = trim_and_count(KEYS[1], minute_ms)
local day = trim_and_count(KEYS[2], day_ms)

local minute_admit = (minute.count + 1) <= minute_limit
local day_admit = (day.count + 1) <= day_limit

local admit_all = minute_admit and day_admit
local minute_reset = seconds_until_oldest_expires(KEYS[1], minute_ms)

if admit_all then
  redis.call('ZADD', KEYS[1], now_ms, request_member)
  redis.call('ZADD', KEYS[2], now_ms, request_member)
  redis.call('PEXPIRE', KEYS[1], minute_ms * 2)
  redis.call('PEXPIRE', KEYS[2], day_ms * 2)

  local remaining = minute_limit - (minute.count + 1)
  if remaining < 0 then
    remaining = 0
  end

  return { 1, minute_limit, remaining, minute_reset, 0, 'minute' }
end

local retry_after = minute_reset
local binding_window = 'minute'
if not day_admit then
  retry_after = seconds_until_oldest_expires(KEYS[2], day_ms)
  binding_window = 'day'
end

return { 0, minute_limit, 0, minute_reset, retry_after, binding_window }
`;
