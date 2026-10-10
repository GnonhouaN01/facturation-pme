"use server";

import { exposer } from "@/server/actions/exposer";

import { demoAutre } from "../../declarations";

export const autre = exposer(demoAutre);
