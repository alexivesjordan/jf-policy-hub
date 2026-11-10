-- Anyone who can already open Operations can open Sales install quoting.

update public.module_access as sales
set enabled = true
from public.module_access as operations
where sales.profile_id = operations.profile_id
  and sales.module_id = 'sales'
  and operations.module_id = 'operations'
  and operations.enabled
  and sales.enabled is distinct from true;
