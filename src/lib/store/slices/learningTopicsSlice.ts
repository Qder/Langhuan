"use client";

import type { StateCreator } from "zustand";
import {
  addTopicCitation,
  addTopicNote,
  createTopic,
  deleteTopic,
  removeTopicCitation,
  removeTopicNote,
  renameTopic,
  setTopicDescription,
} from "../../learningTopics";
import type { LanghuanState } from "../types";

type LearningTopicsSliceKeys =
  | "learningTopics"
  | "activeTopicId"
  | "createLearningTopic"
  | "renameLearningTopic"
  | "setLearningTopicDescription"
  | "deleteLearningTopic"
  | "addLearningTopicNote"
  | "removeLearningTopicNote"
  | "addLearningTopicCitation"
  | "removeLearningTopicCitation"
  | "setActiveTopicId";

export type LearningTopicsSlice = Pick<LanghuanState, LearningTopicsSliceKeys>;

export const createLearningTopicsSlice: StateCreator<
  LanghuanState,
  [],
  [],
  LearningTopicsSlice
> = (set, get) => ({
  learningTopics: [],
  activeTopicId: null,
  setActiveTopicId: (id) => set({ activeTopicId: id }),
  createLearningTopic: (input) => {
    const topic = createTopic({
      title: input.title,
      description: input.description,
    });
    set((s) => ({ learningTopics: [topic, ...s.learningTopics] }));
    get().setStatus(`已创建专题「${topic.title}」`);
    return topic;
  },
  renameLearningTopic: (id, title) => {
    const next = renameTopic(get().learningTopics, id, title);
    if (next === get().learningTopics) return;
    set({ learningTopics: next });
    const topic = next.find((t) => t.id === id);
    if (topic) get().setStatus(`已重命名专题为「${topic.title}」`);
  },
  setLearningTopicDescription: (id, description) => {
    const next = setTopicDescription(get().learningTopics, id, description);
    if (next !== get().learningTopics) set({ learningTopics: next });
  },
  deleteLearningTopic: (id) => {
    const title = get().learningTopics.find((t) => t.id === id)?.title;
    const next = deleteTopic(get().learningTopics, id);
    if (next === get().learningTopics) return;
    set({
      learningTopics: next,
      activeTopicId: get().activeTopicId === id ? null : get().activeTopicId,
    });
    get().setStatus(title ? `已删除专题「${title}」` : "已删除专题");
  },
  addLearningTopicNote: (id, noteId) => {
    const next = addTopicNote(get().learningTopics, id, noteId);
    if (next !== get().learningTopics) set({ learningTopics: next });
  },
  removeLearningTopicNote: (id, noteId) => {
    const next = removeTopicNote(get().learningTopics, id, noteId);
    if (next !== get().learningTopics) set({ learningTopics: next });
  },
  addLearningTopicCitation: (id, ref) => {
    const next = addTopicCitation(get().learningTopics, id, ref);
    if (next !== get().learningTopics) set({ learningTopics: next });
  },
  removeLearningTopicCitation: (id, citationId) => {
    const next = removeTopicCitation(get().learningTopics, id, citationId);
    if (next !== get().learningTopics) set({ learningTopics: next });
  },
});
