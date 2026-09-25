// The model, loaded once per function instance.

import model from "../model/model.js";
import { load, validate, type Profile } from "../../shared/predict.ts";
import { HttpError } from "./env.ts";

export const rt = load(model);

export function checkProfile(p: Profile): Profile {
  const problems = validate(rt, p);
  if (problems.length) throw new HttpError(400, problems.slice(0, 3).join("; "));
  return p;
}
