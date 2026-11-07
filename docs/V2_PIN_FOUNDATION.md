# V2 protected PIN workflow foundation

PIN requests accept exactly four digits, require a verified player name, and pass the PIN immediately to an injected protection boundary before persistence. The database stores only protected material. Audit events omit PIN and protected material. Delivery requires explicit approval, authorization, successful external confirmation, and then clears protected material. Duplicate active requests and stale transitions fail closed.
