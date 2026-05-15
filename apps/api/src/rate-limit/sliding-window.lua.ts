export const SLIDING_WINDOW_LUA = String.raw`
-- Sliding window counter for minute/day quotas.
-- Decision notes:
-- - D6: two-phase commit (evaluate all windows first, commit only when both allow).
-- - D7: day window uses the same sliding blend as minute.
-- - D8: now_ms comes from Node Date.now() via ARGV; this keeps tests deterministic
--       but can introduce cross-replica clock skew until we move to Redis TIME.
--
-- KEYS:
--   1 minute current bucket key
--   2 minute previous bucket key
--   3 day current bucket key
--   4 day previous bucket key
-- ARGV:
--   1 now_ms
--   2 minute_limit
--   3 day_limit
--
-- Return: {admit_all, minute_limit, remaining, reset_seconds, retry_after_seconds, binding_window}
--   admit path: remaining reflects post-increment minute estimate.
--   reject path: remaining=0 and no writes are performed.

local now_ms = tonumber(ARGV[1])
local minute_limit = tonumber(ARGV[2])
local day_limit = tonumber(ARGV[3])

local minute_ms = 60000
local day_ms = 86400000

local function evaluate(cur_key, prev_key, window_ms, limit)
  local elapsed = now_ms % window_ms
  local prev_weight = (window_ms - elapsed) / window_ms

  local prev_count = tonumber(redis.call('GET', prev_key)) or 0
  local cur_count = tonumber(redis.call('GET', cur_key)) or 0

  local estimated = prev_count * prev_weight + cur_count
  local admit = (math.floor(estimated) + 1) <= limit

  return {
    elapsed = elapsed,
    estimated = estimated,
    cur_count = cur_count,
    admit = admit,
  }
end

local minute = evaluate(KEYS[1], KEYS[2], minute_ms, minute_limit)
local day = evaluate(KEYS[3], KEYS[4], day_ms, day_limit)

local admit_all = minute.admit and day.admit
local minute_reset = math.ceil((minute_ms - minute.elapsed) / 1000)
if minute_reset < 1 then
  minute_reset = 1
end

if admit_all then
  local minute_ttl_ms = minute_ms * 3
  local day_ttl_ms = day_ms * 3

  redis.call('INCR', KEYS[1])
  redis.call('PEXPIRE', KEYS[1], minute_ttl_ms)
  redis.call('INCR', KEYS[3])
  redis.call('PEXPIRE', KEYS[3], day_ttl_ms)

  local minute_after = math.floor(minute.estimated + 1)
  local remaining = minute_limit - minute_after
  if remaining < 0 then
    remaining = 0
  end

  return { 1, minute_limit, remaining, minute_reset, 0, 'minute' }
end

local retry_after = minute_reset
local binding_window = 'minute'
if not day.admit then
  local day_reset = math.ceil((day_ms - day.elapsed) / 1000)
  if day_reset < 1 then
    day_reset = 1
  end

  retry_after = day_reset
  binding_window = 'day'
end

return { 0, minute_limit, 0, minute_reset, retry_after, binding_window }
`;
