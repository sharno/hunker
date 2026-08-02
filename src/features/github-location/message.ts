import { Schema as S } from "effect";
import { m } from "foldkit/message";

export const UpdatedInput = m("UpdatedInput", { value: S.String });
export const SubmittedForm = m("SubmittedForm");

export const Message = S.Union([UpdatedInput, SubmittedForm]);
export type Message = typeof Message.Type;

export const SubmittedLocation = m("SubmittedLocation", { value: S.String });
export const OutMessage = S.Union([SubmittedLocation]);
export type OutMessage = typeof OutMessage.Type;
