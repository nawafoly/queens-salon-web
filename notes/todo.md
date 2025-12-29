PS C:\Users\nawaf\Desktop\salon body\queens-salon-web> npm run build

> my-react-ts-app@0.0.0 build
> tsc -b && vite build

src/pages/DashboardClients.tsx:95:10 - error TS6133: 'downloadCSV' is declared but its value is never read.

95 function downloadCSV(filename: string, rows: string[][]) {
            ~~~~~~~~~~~

src/pages/DashboardOffers.tsx:2:10 - error TS6133: 'Fragment' is declared but its value is never read.

2 import { Fragment, useEffect, useMemo, useRef, useState, type FC } from "react";
           ~~~~~~~~

src/pages/DashboardOffers.tsx:7:3 - error TS6133: 'faPen' is declared but its value is never read.

7   faPen,
    ~~~~~

src/pages/DashboardOffers.tsx:8:3 - error TS6133: 'faBan' is declared but its value is never read.

8   faBan,
    ~~~~~

src/pages/DashboardOffers.tsx:10:3 - error TS6133: 'faXmark' is declared but its value is never read.

10   faXmark,
     ~~~~~~~

src/pages/DashboardOffers.tsx:11:3 - error TS6133: 'faWandMagicSparkles' is declared but its value is never read.        

11   faWandMagicSparkles,
     ~~~~~~~~~~~~~~~~~~~

src/pages/DashboardOffers.tsx:12:3 - error TS6133: 'faImage' is declared but its value is never read.

12   faImage,
     ~~~~~~~

src/pages/DashboardOffers.tsx:13:3 - error TS6133: 'faMagnifyingGlass' is declared but its value is never read.

13   faMagnifyingGlass,
     ~~~~~~~~~~~~~~~~~

src/pages/DashboardOffers.tsx:14:3 - error TS6133: 'faCheck' is declared but its value is never read.

14   faCheck,
     ~~~~~~~

src/pages/DashboardOffers.tsx:100:10 - error TS6133: 'query' is declared but its value is never read.

100   const [query, setQuery] = useState("");
             ~~~~~

src/pages/DashboardOffers.tsx:100:17 - error TS6133: 'setQuery' is declared but its value is never read.

100   const [query, setQuery] = useState("");
                    ~~~~~~~~

src/pages/DashboardOffers.tsx:101:25 - error TS6133: 'setServiceSearch' is declared but its value is never read.

101   const [serviceSearch, setServiceSearch] = useState("");
                            ~~~~~~~~~~~~~~~~

src/pages/DashboardOffers.tsx:102:10 - error TS6133: 'pickedImageName' is declared but its value is never read.

102   const [pickedImageName, setPickedImageName] = useState("");
             ~~~~~~~~~~~~~~~

src/pages/DashboardOffers.tsx:128:9 - error TS6133: 'discountLabel' is declared but its value is never read.

128   const discountLabel =
            ~~~~~~~~~~~~~

src/pages/DashboardOffers.tsx:189:9 - error TS6133: 'servicesGrouped' is declared but its value is never read.

189   const servicesGrouped = useMemo(() => {
            ~~~~~~~~~~~~~~~

src/pages/DashboardOffers.tsx:247:9 - error TS6133: 'onPickImage' is declared but its value is never read.

247   const onPickImage = async (file: File | null) => {
            ~~~~~~~~~~~

src/pages/DashboardSettings.tsx:145:29 - error TS2304: Cannot find name 'db'.

145         const userRef = doc(db, "users", user.uid);
                                ~~

src/pages/DashboardSettings.tsx:259:34 - error TS2304: Cannot find name 'db'.

259       const q = query(collection(db, "users"), orderBy("createdAt", "desc"));
                                     ~~

src/pages/DashboardSettings.tsx:319:13 - error TS2304: Cannot find name 'db'.

319         doc(db, "users", uid),
                ~~

src/pages/EmployeePortal.tsx:4:3 - error TS6133: 'addDoc' is declared but its value is never read.

4   addDoc,
    ~~~~~~

src/pages/EmployeePortal.tsx:9:3 - error TS6133: 'serverTimestamp' is declared but its value is never read.

9   serverTimestamp,
    ~~~~~~~~~~~~~~~

src/pages/EmployeePortal.tsx:15:3 - error TS6133: 'faPlus' is declared but its value is never read.

15   faPlus,
     ~~~~~~

src/pages/EmployeePortal.tsx:17:3 - error TS6133: 'faXmark' is declared but its value is never read.

17   faXmark,
     ~~~~~~~

src/pages/Services.tsx:1:1 - error TS6133: 'React' is declared but its value is never read.

1 import React from "react";
  ~~~~~~~~~~~~~~~~~~~~~~~~~~


Found 24 errors.
