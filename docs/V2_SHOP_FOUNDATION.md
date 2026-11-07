# V2 shop and catalog search foundation

Shop search reads only the active trusted catalog. Queries are normalized and bounded, and matching uses creature names plus approved aliases. Disabled and untameable entries are excluded. Optional map and DLC filters are applied before deterministic pagination. Public results contain only ID, display name, and DLC warning metadata; blueprint paths, aliases, maps, and internal catalog fields are not exposed. DLC warnings do not collect or infer ownership.
