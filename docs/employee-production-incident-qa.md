# Employee production incident QA

Repeat these checks on desktop and mobile viewports.

## Avatars

1. Open the employee directory with a valid image, no image, an invalid URL, and a deleted Storage object.
2. Confirm every avatar keeps the same dimensions while loading.
3. Confirm failures show initials and never the browser broken-image icon.
4. Confirm off-screen directory and booking avatars use lazy loading.

## Archive

1. Archive an active employee and confirm the warning explains that history is retained.
2. Confirm the employee disappears immediately from the directory.
3. Refresh and confirm the employee does not return.
4. Confirm the employee is absent from public and internal new-booking selectors.
5. Confirm historical bookings still show their saved employee name.
6. Deny the write in a rules test environment and confirm the directory rolls back and shows an error.

## Schedule and availability

1. Disable a weekly day, save, and confirm public/internal booking show the same unavailable state.
2. Re-enable the day, save, and confirm both booking pages refresh without manual cache clearing.
3. Verify temporary leave, an approved leave request, no working shift, a conflicting booking, and archived staff remain distinct states.
4. Repeat around midnight using the Asia/Riyadh date.

## Reads and lifecycle

1. Open and close the employee page twice and compare Firestore reads.
2. Confirm there is no polling and subscriptions are removed on unmount.
3. Confirm booking statistics issue one month-bounded booking query and are cached for five minutes.
