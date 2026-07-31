import { Runtime } from "foldkit";

import "./styles.css";
import { makeReviewElement } from "./main";

const container = document.getElementById("root");

if (container === null) {
  throw new Error("Hunker root element is missing");
}

Runtime.run(makeReviewElement(container));
