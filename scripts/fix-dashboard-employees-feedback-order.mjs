import fs from "node:fs";

const file = "src/pages/DashboardEmployees.tsx";
let source = fs.readFileSync(file, "utf8");

const busyAnchor = "  const busy = loading || saving;\n";
const stateAnchor = "  const [specialtyFilter, setSpecialtyFilter] = useState<string>(\"all\");\n\n  const [isOpen, setIsOpen] = useState(false);\n";

if (!source.includes(busyAnchor)) {
  throw new Error("Missing busy anchor in DashboardEmployees.tsx");
}
if (!source.includes(stateAnchor)) {
  throw new Error("Missing isOpen state anchor in DashboardEmployees.tsx");
}

source = source.replace(
  busyAnchor,
  "  const [isOpen, setIsOpen] = useState(false);\n  const busy = loading || saving;\n",
);
source = source.replace(
  stateAnchor,
  "  const [specialtyFilter, setSpecialtyFilter] = useState<string>(\"all\");\n",
);

const first = source.indexOf("const [isOpen, setIsOpen] = useState(false);");
const second = source.indexOf("const [isOpen, setIsOpen] = useState(false);", first + 1);
if (first < 0 || second >= 0) {
  throw new Error("Expected exactly one isOpen state declaration after patch");
}
if (source.indexOf("const [isOpen, setIsOpen] = useState(false);") > source.indexOf("if (!errorMsg || isOpen) return;")) {
  throw new Error("isOpen state must be declared before contextual error effect");
}

fs.writeFileSync(file, source);
console.log("Moved isOpen state before contextual feedback effect.");
