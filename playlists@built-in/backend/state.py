_state = {"db": None}


def set_db(db) -> None:
    _state["db"] = db


def get_db():
    return _state["db"]