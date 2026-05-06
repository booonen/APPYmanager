// English — default language
// To create a new language: copy this file, rename it (e.g. mycustomlang.js),
// change the registerLanguage call, translate the strings, and add a <script>
// tag in appymanager.html before the init block.
registerLanguage('en', 'English', {
  "app": {
    "name": "APPYmanager"
  },
  "nav_section": {
    "geography": "Geography",
    "system": "System"
  },
  "nav": {
    "dashboard": "Dashboard",
    "plots": "Plots",
    "map": "Map",
    "settings": "Settings",
    "import_export": "Import / Export"
  },
  "page": {
    "dashboard": "Dashboard",
    "plots": "Plots",
    "map": "Map",
    "settings": "Settings",
    "import_export": "Import / Export"
  },
  "subtitle": {
    "dashboard": "Project overview at a glance",
    "plots": "All plots in the project",
    "map": "Geographic view of plots and boundaries",
    "settings": "Project configuration",
    "import_export": "Move project data in and out"
  },
  "btn": {
    "saves": "Saves",
    "load": "Load",
    "rename": "Rename",
    "duplicate": "Duplicate",
    "close": "Close",
    "cancel": "Cancel",
    "confirm": "Confirm",
    "new_project": "+ New Project",
    "import_json": "Import JSON",
    "export_json": "Export JSON"
  },
  "save_mgr": {
    "title": "Save Manager",
    "col_project": "Project",
    "col_modified": "Modified",
    "col_stats": "Stats",
    "active": "(active)",
    "unnamed": "Unnamed Project",
    "no_saves": "No saves yet.",
    "storage": "Storage",
    "json_file": "JSON Save File",
    "confirm_delete": "Delete \"{name}\"?\nThis cannot be undone.",
    "confirm_new": "Start a new empty project?\nYour current project will be saved before switching.",
    "prompt_rename": "Rename project:"
  },
  "toast": {
    "loaded": "Loaded \"{name}\"",
    "save_deleted": "Save deleted",
    "duplicated": "Duplicated \"{name}\"",
    "data_exported": "Data exported",
    "imported": "Project imported",
    "invalid_json": "Invalid JSON file",
    "new_project": "New project started",
    "lang_not_found": "Language \"{code}\" not found"
  },
  "ie": {
    "json_title": "JSON Save File",
    "json_desc": "Export the entire current project as a JSON file, or import a previously exported save file as a new project.",
    "saves_title": "Manage Saves",
    "saves_desc": "Rename, duplicate, or delete saved projects.",
    "manage_saves": "Open Save Manager"
  },
  "settings": {
    "language": "Language",
    "language_desc": "Interface language."
  },
  "stat": {
    "plots": "Plots",
    "boundaries": "Boundaries",
    "boundary_types": "Boundary Types",
    "properties": "Properties"
  },
  "dashboard": {
    "welcome_title": "Welcome to APPYmanager",
    "welcome_body": "Manage demographics for your OpenGeofiction country. Head to the Plots tab to import your first boundary from OGF; the Map tab will visualise what you bring in."
  },
  "plots": {
    "import_btn": "Import boundary",
    "count": "{n} plot(s)",
    "col_name": "Name",
    "col_ogf_id": "OGF Relation ID",
    "col_plot_id": "Plot ID",
    "unnamed": "(unnamed)",
    "empty_title": "No plots yet",
    "empty_body": "Import a boundary from OpenGeofiction to get started. Each imported relation becomes a plot."
  },
  "import": {
    "title": "Import boundary",
    "tab_search": "Search",
    "tab_byid": "By ID",
    "tab_custom": "Custom Overpass",
    "search_area_label": "Search area (where to look)",
    "search_area_help": "Filters that define the spatial scope of the search. Multiple rows are AND'd. Example: name=Antwerpen, admin_level=6.",
    "import_label": "To import (which shapes)",
    "import_help": "Filters for shapes inside the search area to import as plots. Each matching relation becomes one plot.",
    "byid_label": "OGF Relation ID",
    "byid_help": "The numeric id of an OGF relation. Found in the URL on opengeofiction.net.",
    "custom_label": "Custom Overpass query",
    "custom_help": "Power-user override. Sent verbatim. A leading [bbox:s,w,n,e]; settings block is honoured (we merge [out:json] into it). 'out body;' with '(._;>;);' is the canonical recursion idiom; 'out geom;' (overpass-turbo's wizard default) also works — we synthesise the missing way/node layer.",
    "add_row": "Add row",
    "remove_row": "Remove row",
    "key_placeholder": "key (e.g. admin_level)",
    "value_placeholder": "value (e.g. 2)",
    "import_btn": "Import",
    "commit_btn": "Commit ({n})",
    "fetching": "Querying Overpass…",
    "found": "Found {n} shape(s)",
    "skipped": "{n} skipped (unclosed or empty rings)",
    "no_results": "No shapes matched.",
    "rejected_overlap": "overlaps an existing plot",
    "rejected_summary": "{n} shape(s) will be skipped because they overlap existing plots.",
    "imported_toast": "Imported {n} plot(s)",
    "error_empty_filters": "Both search-area and to-import need at least one filter row.",
    "error_byid_invalid": "Enter a numeric relation ID.",
    "error_custom_empty": "Enter a custom Overpass query.",
    "error_query_build": "Could not build query: {msg}",
    "error_fetch": "Overpass request failed: {msg}",
    "error_parse": "Could not parse response: {msg}",
    "error_rate_limited": "Overpass is rate-limiting you — try again in ~{seconds}s.",
    "error_rate_limited_no_eta": "Overpass is rate-limiting you — wait a bit and try again."
  }
});
