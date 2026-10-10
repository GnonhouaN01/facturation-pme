"use server";

import { exposer } from "@/server/actions/exposer";

import { demoAgir } from "../../declarations";

export const agir = exposer(demoAgir);
