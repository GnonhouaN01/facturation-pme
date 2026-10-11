"use server";

import { exposer } from "@/server/actions/exposer";

import { declarationALaMain } from "../../declarations";

export const aLaMain = exposer(declarationALaMain);
