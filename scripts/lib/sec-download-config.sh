#!/usr/bin/env bash
# Shared validation: an enabled producer and its consumers must use one cache.
case "${SEC_INCREMENTAL_DOWNLOADS_ENABLED:-0}" in 0|1) ;; *) echo 'SEC_INCREMENTAL_DOWNLOADS_ENABLED must be 0 or 1' >&2; exit 1 ;; esac
if [[ "${SEC_INCREMENTAL_DOWNLOADS_ENABLED:-0}" == 1 ]]; then
  : "${SEC_DOCUMENT_CACHE_BUCKET:?Set the private SEC document cache bucket}"
  [[ "$SEC_DOCUMENT_CACHE_BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,220}[a-z0-9]$ ]] || { echo 'Invalid SEC cache bucket' >&2; exit 1; }
fi
sec_download_env="|SEC_INCREMENTAL_DOWNLOADS_ENABLED=${SEC_INCREMENTAL_DOWNLOADS_ENABLED:-0}|SEC_DOCUMENT_CACHE_BUCKET=${SEC_DOCUMENT_CACHE_BUCKET:-}"
