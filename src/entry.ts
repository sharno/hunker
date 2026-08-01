import { Runtime } from "foldkit";

import "./styles.css";
import { makeReviewApplication } from "./main";

const container = document.getElementById("root");

if (container === null) {
  throw new Error("Hunker root element is missing");
}

Runtime.run(makeReviewApplication(container));
