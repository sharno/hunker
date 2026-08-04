import type { HttpClient } from "effect/unstable/http";
import { Http } from "foldkit";

export type AppResources = HttpClient.HttpClient;

export const appResources = Http.layer;
