# Website presentation libraries

Timeline projection, chart layout, geometry, and animation helpers belong here.
Website components and their supporting web API routes can use these modules.
Data models and processing shared with collectors or background jobs stay outside
this directory in `src/lib/`.

Changes within `src/lib/ui/` do not trigger background-worker deployment. CI bundles
every entry point declared in both worker Dockerfiles and fails if any bundle
imports a module from this directory, including through a shared library. Move
genuinely shared logic outside this boundary before using it in a worker.
