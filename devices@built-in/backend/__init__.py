from omniplayr.plugins import request_db_access, log

PLUGIN_KEY = "devices@built-in"

from . import devices

def setup():
    log(f"Setting up database for {PLUGIN_KEY}", "debug")
    db = request_db_access(
        PLUGIN_KEY,
        own={
            "devices": {
                "id": "SERIAL PRIMARY KEY",
                "account_id": "INT DEFAULT NULL",
                "label": "TEXT DEFAULT NULL",
                "identifier": "TEXT NOT NULL",
                "type": "VARCHAR(255) NOT NULL",
                "ip": "VARCHAR(255) DEFAULT NULL",
                "status": "VARCHAR(255) DEFAULT NULL",
                "expires_at": "TIMESTAMPTZ DEFAULT NULL",
                "created_at": "TIMESTAMPTZ NOT NULL DEFAULT NOW()",
                "updated_at": "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
            },
            "device_commands": {
                "id": "SERIAL PRIMARY KEY",
                "account_id": "INT NOT NULL",
                "target_device_id": "INT NOT NULL",
                "type": "VARCHAR(255) NOT NULL",
                "payload": "TEXT DEFAULT NULL",
                "created_at": "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
            }
        }
    )

    log("Sending devices database to devices.py", "debug")
    devices.init(db)

    log(f"Finished setting up database for {PLUGIN_KEY}", "debug")
