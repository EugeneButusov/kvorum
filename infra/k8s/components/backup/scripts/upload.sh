#!/bin/sh
set -eu
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DOW=$(date -u +%u)

echo "[upload] daily/$STAMP"
rclone --config /dev/null copy /backup "r2:$R2_BUCKET/daily/$STAMP/" --s3-no-check-bucket

# Sunday's dump is also kept on the longer weekly rotation.
if [ "$DOW" = "7" ]; then
  echo "[upload] weekly/$STAMP"
  rclone --config /dev/null copy /backup "r2:$R2_BUCKET/weekly/$STAMP/" --s3-no-check-bucket
fi

# Retention: 7 daily, 4 weekly. Prune objects first, then the empty prefixes.
echo "[upload] pruning"
rclone --config /dev/null delete --min-age 7d  "r2:$R2_BUCKET/daily/"  || true
rclone --config /dev/null delete --min-age 28d "r2:$R2_BUCKET/weekly/" || true
rclone --config /dev/null rmdirs --leave-root "r2:$R2_BUCKET/daily/"  || true
rclone --config /dev/null rmdirs --leave-root "r2:$R2_BUCKET/weekly/" || true

echo "[upload] done; current contents:"
rclone --config /dev/null lsf "r2:$R2_BUCKET/" --dirs-only
