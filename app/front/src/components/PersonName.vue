<script setup lang="ts">
import { compactName } from "../utils/display";
defineProps<{ name: string }>();
</script>
<template>
  <span class="person-name" :title="name"><span class="person-full">{{ name }}</span><span class="person-compact" aria-hidden="true">{{ compactName(name) }}</span></span>
</template>
