/*
 * speedy-vision.js
 * GPU-accelerated Computer Vision for JavaScript
 * Copyright 2020-2021 Alexandre Martins <alemartf(at)gmail.com>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * upload-keypoints.glsl
 * Upload keypoints to the GPU via Uniform Buffer Object
 */

@include "keypoints.glsl"

uniform int keypointCount; // how many keypoints
uniform int descriptorSize; // in bytes
uniform int extraSize; // in bytes
uniform int encoderLength;

#ifndef KEYPOINT_BUFFER_LENGTH
#error Must specify KEYPOINT_BUFFER_LENGTH
#endif

layout(std140) uniform KeypointBuffer
{
    // tightly packed (16 bytes)
    vec4 keypointBuffer[KEYPOINT_BUFFER_LENGTH]; // xpos, ypos, lod, score
};

void main()
{
    ivec2 thread = threadLocation();
    KeypointAddress address = findKeypointAddress(thread, encoderLength, descriptorSize, extraSize);
    int index = findKeypointIndex(address, descriptorSize, extraSize);

    // the keypoint doesn't exist
    color = encodeNullKeypoint();
    if(index >= keypointCount)
        return;
    
    // get keypoint data
    vec4 data = keypointBuffer[index];

    // fill in the keypoint data
    switch(address.offset) {
        case 0: {
            // keypoint position
            fixed2_t pos = vec2tofix(data.xy);
            fixed2_t lo = pos & 255;
            fixed2_t hi = (pos >> 8) & 255;
            color = vec4(float(lo.x), float(hi.x), float(lo.y), float(hi.y)) / 255.0f;
            break;
        }

        case 1: {
            // keypoint score & scale
            float score = clamp(data.w, 0.0f, 1.0f);
            float scale = encodeLod(data.z);
            float rotation = encodeOrientation(0.0f);
            float flags = encodeKeypointFlags(KPF_NONE);
            color = vec4(scale, rotation, score, flags);
            break;
        }

        default: {
            // keypoint descriptor or extra data
            color = vec4(0.0f);
            break;
        }
    }
}