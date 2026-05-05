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
    "map": "Map",
    "settings": "Settings",
    "import_export": "Import / Export"
  },
  "page": {
    "dashboard": "Dashboard",
    "map": "Map",
    "settings": "Settings",
    "import_export": "Import / Export"
  },
  "subtitle": {
    "dashboard": "Project overview at a glance",
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
    "welcome_body": "Manage demographics for your OpenGeofiction country. Start by importing a top-level boundary on the Map tab — that comes in the next brick. For now, this shell handles save management, JSON import/export, and shows the OGF map."
  }
});
