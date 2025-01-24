const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const width = 1000;
const height = 1000;

canvas.style.width = width + "px";
canvas.style.height = height  + "px";
canvas.width = width;
canvas.height = height;

const objects = [
    {
        type: "sphere",
        center: { x: -3, y: 0, z: 0 },
        radius: 3,
        color: { r: 1.0, g: 0.0, b: 0.0 }, 
        roughness: 0,
        reflectivity: 1
    },

    {
        type: "sphere",
        center: { x: 0, y: -2.5, z: 3 },
        radius: 1,
        color: { r: 1.0, g: 1.0, b: 0.0 }, 
        roughness: 0,
        reflectivity: 1
    },
    {
        type: "sphere",
        center: { x: 3.1, y: 0, z: 2 },
        radius: 3,
        color: { r: 0.0, g: 0.0, b: 0.0 }, 
        roughness: 0.9,
        reflectivity: 1
    },
    {
        type: "sphere",
        center: { x: 0, y: 5, z: 0.1 },
        radius: 2,
        color: { r: 0.0, g: 0.0, b: 0.0 }, 
        roughness: 0.9,
        reflectivity: 1
    },

    {
        type: "sphere",
        center: { x: 2, y: 5, z: 4 },
        radius: 2,
        color: { r: 0.0, g: 0.0, b: 1 }, 
        roughness: 0.9,
        reflectivity: 1
    },
];

const camera = { position: { x: 0, y: 0, z: 5 }, width: 10, height: 10 };

const accumulationBuffer = createColorBuffer(width, height);
const canvasBuffer = createColorBuffer(width, height);
const maxSamples = 200;

async function animate() {

    // Step 1: Initialize the accumulation buffer
    const accumulationBuffer = new Float32Array(width * height * 4);

    for (let sample = 0; sample < maxSamples; sample++) {
        // Step 2: Create a frame buffer for this sample
        const frameBuffer = new Float32Array(width * height * 4);

        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                // Ray origin (camera position)
                const origin = {
                    x: camera.position.x,
                    y: camera.position.y,
                    z: camera.position.z,
                };

                // Calculate the direction for the ray
                const planePoint = pixelToWorldPerspective(x, y, width, height, camera);
                let direction = {
                    x: planePoint.x - origin.x,
                    y: planePoint.y - origin.y,
                    z: planePoint.z - origin.z,
                };

                // Normalize the direction vector
                const mag = Math.sqrt(direction.x ** 2 + direction.y ** 2 + direction.z ** 2);
                direction.x /= mag;
                direction.y /= mag;
                direction.z /= mag;

                // Cast the ray and get the resulting color
                const newColor = castRay(origin, direction);

                // Store the pixel color in the frame buffer
                setPixel(frameBuffer, x, y, width, newColor.r, newColor.g, newColor.b, newColor.a);
            }
        }

        // Step 3: Accumulate the frame buffer into the accumulation buffer
        accumulateFrame(accumulationBuffer, frameBuffer);

        // Step 4: Compute the progressive average and apply to the canvas
        const averagedBuffer = computeAverage(accumulationBuffer, sample + 1, width, height); // sample + 1 because it's 1-based
        applyBufferToCanvas(ctx, averagedBuffer, width, height);

        // Visualize rendering progress
        await sleep(1); // Small delay for smoother visualization
        console.log(`Rendered sample ${sample + 1}/${maxSamples}`);
    }

    // Step 5: Apply the final averaged buffer
    const averagedBuffer = computeAverage(accumulationBuffer, maxSamples, width, height);
    applyBufferToCanvas(ctx, averagedBuffer, width, height);
    console.log('Rendering complete');
}


window.requestAnimationFrame(animate)



function castRay(origin, direction, maxSteps = 5) {
    let accumulatedColor = { r: 0, g: 0, b: 0 }; // Start with black
    let intensity = 1; // Start with full intensity (1.0)
    let remainingSteps = maxSteps;

    while (remainingSteps > 0) { // Stop if intensity is negligible
        const hits = [];

        // Find intersections with all objects
        for (const object of objects) {
            switch (object.type) {
                case "sphere": {
                    const intersection = { point: { x: 0, y: 0, z: 0 }, distance: 0 };
                    const hit = intersectRayWithSphere(object.center, object.radius, origin, direction, intersection);
                    if (hit) {
                        hits.push({ intersection, object });
                    }
                    break;
                }
            }
        }

        if (hits.length === 0) {
            break; // No more intersections, terminate
        }

        // Find the closest intersection
        const closest = hits.reduce((min, current) => {
            return current.intersection.distance < min.intersection.distance ? current : min;
        });
        const distance = closest.intersection.distance;
        const reflectivity = closest.object.reflectivity || 0.8;
        const roughness = closest.object.roughness;

        
        // Reflect the ray
        const normal = {
            x: (closest.intersection.point.x - closest.object.center.x) / closest.object.radius,
            y: (closest.intersection.point.y - closest.object.center.y) / closest.object.radius,
            z: (closest.intersection.point.z - closest.object.center.z) / closest.object.radius,
        };

        // Reduce intensity for the next bounce
        intensity = calculateBounceIntensity(closest, direction, normal, intensity, maxSteps - remainingSteps)

        // Calculate blend factor based on distance
        const blendFactor = intensity * Math.min(distance, 1.0);

        // Accumulate the color, weighted by blend factor
        accumulatedColor = blendColors(accumulatedColor, closest.object.color, blendFactor);

        // Reflect
        direction = reflectWithRoughness(direction, normal, roughness || 0)

        // Move the origin slightly to avoid self-intersection
        origin = {
            x: closest.intersection.point.x + direction.x * 1e-4,
            y: closest.intersection.point.y + direction.y * 1e-4,
            z: closest.intersection.point.z + direction.z * 1e-4,
        };

        remainingSteps--;
    }

    return accumulatedColor
}


async function sleep(duration) {
    return await new Promise((resolve) => setTimeout(resolve, duration));
}


/**
 * Tests for intersection of a ray with a sphere.
 * @param {Object} ray - The ray object with origin and direction.
 * @param {Object} sphere - The sphere object with center and radius.
 * @returns {Object|null} An object containing intersection point, normal, and distance, or null if no intersection.
 */
function raySphereIntersection(ray, sphere) {
    const { origin, direction } = ray;
    const { center, radius } = sphere;

    // Vector from ray origin to sphere center
    const oc = {
        x: origin.x - center.x,
        y: origin.y - center.y,
        z: origin.z - center.z,
    };

    // Compute coefficients for quadratic equation
    const a = 1; // Because direction is normalized
    const b = 2 * (oc.x * direction.x + oc.y * direction.y + oc.z * direction.z);
    const c = oc.x ** 2 + oc.y ** 2 + oc.z ** 2 - radius ** 2;

    // Discriminant of the quadratic equation
    const discriminant = b ** 2 - 4 * c;

    // If the discriminant is negative, there is no intersection
    if (discriminant < 0) {
        // console.log(`No intersection: ray=${JSON.stringify(ray)}, sphere=${JSON.stringify(sphere)}`);
        return null;
    }

    // Calculate the solutions
    const sqrtDiscriminant = Math.sqrt(discriminant);
    const t1 = (-b - sqrtDiscriminant) / 2;
    const t2 = (-b + sqrtDiscriminant) / 2;

    // Determine the closest positive intersection
    let t = null;
    if (t1 >= 0 && t2 >= 0) {
        t = Math.min(t1, t2);
    } else if (t1 >= 0) {
        t = t1;
    } else if (t2 >= 0) {
        t = t2;
    }

    if (t !== null) {
        const intersection = {
            x: origin.x + t * direction.x,
            y: origin.y + t * direction.y,
            z: origin.z + t * direction.z,
        };

        return {
            intersection,
            distance: t,
        };
    }

    // console.log(`No valid intersection: ray=${JSON.stringify(ray)}, sphere=${JSON.stringify(sphere)}`);
    return null;
}

/**
 * Maps a pixel coordinate to world space in an orthographic camera.
 * @param {number} pixelX - The x-coordinate in pixel space.
 * @param {number} pixelY - The y-coordinate in pixel space.
 * @param {number} viewportWidth - The width of the viewport in pixels.
 * @param {number} viewportHeight - The height of the viewport in pixels.
 * @param {Object} camera - The orthographic camera with position and size.
 * @returns {Object} The world coordinates {x, y, z}.
 */
function pixelToWorld(pixelX, pixelY, viewportWidth, viewportHeight, camera) {
    const { position, width, height } = camera;

    // Convert pixel to normalized device coordinates (NDC)
    const ndcX = (pixelX / viewportWidth) * 2 - 1;
    const ndcY = 1 - (pixelY / viewportHeight) * 2; // Flip Y axis for screen space

    // Map NDC to world coordinates
    const worldX = ndcX * (width / 2) + position.x;
    const worldY = ndcY * (height / 2) + position.y;

    // Return the world coordinates (z can be camera's z if needed)
    return { x: worldX, y: worldY, z: position.z };
}

function dotProduct(v1, v2) {
    return v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
}

function squaredLength(v) {
    return dotProduct(v, v);
}
function intersectRayWithSphere(center, radius, origin, direction, intersection) {
    // Vector from ray origin to sphere center
    var OC = intersection; // Use the output parameter as temporary workspace

    OC.x = origin.x - center.x;
    OC.y = origin.y - center.y;
    OC.z = origin.z - center.z;

    // Solve the quadratic equation a t^2 + 2 t b + c = 0
    var a = squaredLength(direction);
    var b = dotProduct(direction, OC);
    var c = squaredLength(OC) - radius * radius;
    var delta = b * b - a * c;

    // console.log(`a: ${a}, b: ${b}, c: ${c}, delta: ${delta}`);

    if (delta < 0) {
        // console.log("No intersection: delta < 0");
        return false;
    }

    var sqrtDelta = Math.sqrt(delta);
    var tMin = (-b - sqrtDelta) / a;
    var tMax = (-b + sqrtDelta) / a;

    // console.log("tMin:", tMin, "tMax:", tMax);

    if (tMax < 0) {
        // console.log("All intersections behind ray origin");
        return false;
    }

    var t = tMin >= 0 ? tMin : tMax;

    intersection.point.x = origin.x + t * direction.x;
    intersection.point.y = origin.y + t * direction.y;
    intersection.point.z = origin.z + t * direction.z;
    intersection.distance = t;

    // console.log("Intersection:", intersection);

    return true;
}

function pixelToWorldPerspective(px, py, viewportW, viewportH, camera) {
    // Convert pixel to normalized device coords
    const ndcX = (px / viewportW) * 2 - 1;    // -1..1
    const ndcY = 1 - (py / viewportH) * 2;    //  1..-1

    // Map onto some "view plane" at z=0, with a size of camera.width x camera.height
    const halfW = camera.width / 2;
    const halfH = camera.height / 2;

    const worldX = ndcX * halfW;  // No + camera.position.x here
    const worldY = ndcY * halfH;  // because the plane is "in front of" the camera
    const worldZ = 0;             // We place the plane at z=0

    return { x: worldX, y: worldY, z: worldZ };
}

function remapToUnitRange(x, originalMin, originalMax) {
    return (x - originalMin) / (originalMax - originalMin);
}

function toneMap(color) {
    return {
        r: color.r / (1.0 + color.r),
        g: color.g / (1.0 + color.g),
        b: color.b / (1.0 + color.b),
    };
}

function colorToStyle(color) {
    const mappedColor = toneMap(color);
    return `rgb(${Math.round(mappedColor.r * 255)}, 
                ${Math.round(mappedColor.g * 255)}, 
                ${Math.round(mappedColor.b * 255)})`;
}

function blendColors(baseColor, hitColor, factor = 0.5) {
    return {
        r: baseColor.r + factor * (hitColor.r - baseColor.r),
        g: baseColor.g + factor * (hitColor.g - baseColor.g),
        b: baseColor.b + factor * (hitColor.b - baseColor.b),
    };
}

// Reflect the ray with roughness
function reflectWithRoughness(direction, normal, roughness) {
    // Calculate the perfect reflection direction
    const dot = dotProduct(direction, normal);
    let reflected = {
        x: direction.x - 2 * dot * normal.x,
        y: direction.y - 2 * dot * normal.y,
        z: direction.z - 2 * dot * normal.z,
    };

    // Add roughness by introducing a small random offset
    if (roughness > 0) {
        const randomVector = randomInUnitSphere();
        reflected.x += roughness * randomVector.x;
        reflected.y += roughness * randomVector.y;
        reflected.z += roughness * randomVector.z;

        // Normalize the resulting direction
        const magnitude = Math.sqrt(reflected.x ** 2 + reflected.y ** 2 + reflected.z ** 2);
        reflected.x /= magnitude;
        reflected.y /= magnitude;
        reflected.z /= magnitude;
    }

    return reflected;
}

function randomInUnitSphere() {
    let x, y, z;
    do {
        x = Math.random() * 2 - 1; // Random value between -1 and 1
        y = Math.random() * 2 - 1;
        z = Math.random() * 2 - 1;
    } while (x ** 2 + y ** 2 + z ** 2 >= 1); // Ensure it lies within a unit sphere

    return { x, y, z };
}


function createColorBuffer(width, height) {
    // Initialize the buffer with a flat array (RGBA for each pixel)
    const buffer = new Float32Array(width * height * 4); // Float32 allows for HDR or precise calculations
    return buffer
}

function setPixel(buffer, x, y, width, r, g, b, a = 1.0) {
    const index = (y * width + x) * 4; // Calculate pixel index
    buffer[index] = r;    // Red
    buffer[index + 1] = g; // Green
    buffer[index + 2] = b; // Blue
    buffer[index + 3] = a; // Alpha
}

function getPixel(buffer, x, y, width) {
    const index = (y * width + x) * 4;
    return {
        r: buffer[index],
        g: buffer[index + 1],
        b: buffer[index + 2],
        a: buffer[index + 3],
    };
}

function blendPixel(buffer, x, y, width, r, g, b, a, factor = 0.5) {
    const index = (y * width + x) * 4;

    // Blend the colors
    buffer[index] = buffer[index] * (1 - factor) + r * factor; // Red
    buffer[index + 1] = buffer[index + 1] * (1 - factor) + g * factor; // Green
    buffer[index + 2] = buffer[index + 2] * (1 - factor) + b * factor; // Blue
    buffer[index + 3] = buffer[index + 3] * (1 - factor) + a * factor; // Alpha
}

function applyBufferToCanvas(ctx, buffer, width, height) {
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    for (let i = 0; i < buffer.length; i++) {
        data[i] = Math.pow(buffer[i], 1 / 2.2) * 255
    }

    ctx.putImageData(imageData, 0, 0);
}
function addPixel(buffer, x, y, width, r, g, b, a = 1.0) {
    const index = (y * width + x) * 4;

    // Add the color values
    buffer[index] += r;    // Red
    buffer[index + 1] += g; // Green
    buffer[index + 2] += b; // Blue
    buffer[index + 3] += a; // Alpha
}

function averageBuffer(buffer, frameCount) {
    for (let i = 0; i < buffer.length; i++) {
        buffer[i] /= frameCount; // Compute the average
    }
}

function addFrameToBuffer(buffer, frame) {
    for (let i = 0; i < frame.length; i++) {
        buffer[i] += frame[i]; // Accumulate the color
    }
}

function multiplyFrameToBuffer(buffer, frame, width) {
    for (let i = 0; i < frame.length; i++) {

        // Multiply the color values
        buffer[i] *= frame[i]    // Red
        buffer[i + 1] *= frame[i + 1]; // Green
        buffer[i + 2] *= frame[i +2 ]; // Blue
        buffer[i + 3] *= frame[i + 3]|| 1; // Alpha
    }
}

function blendFrameToBuffer(buffer, frame, factor = 0.5) {
    for (let index = 0; index < frame.length; index++) {

        // Multiply the color values
        buffer[index] = buffer[index] * (1 - factor) + frame[index] * factor; // Red
        buffer[index + 1] = buffer[index + 1] * (1 - factor) + frame[index + 1] * factor; // Green
        buffer[index + 2] = buffer[index + 2] * (1 - factor) + frame[index + 2] * factor; // Blue
        // buffer[index + 3] = buffer[index + 3] * (1 - factor) + (frame[index + 3] || 1) * factor; // Alpha
    }
}


function multiplyPixel(buffer, x, y, width, r, g, b, a = 1.0) {
    const index = (y * width + x) * 4;

    // Multiply the color values
    buffer[index] *= r;    // Red
    buffer[index + 1] *= g; // Green
    buffer[index + 2] *= b; // Blue
    buffer[index + 3] *= a; // Alpha
}


function calculateBounceIntensity(closest, direction, normal, initialIntensity, maxBounces) {
    let intensity = initialIntensity;
    const baseReflectivity = closest.object.reflectivity || 0.8;

    for (let bounce = 0; bounce < maxBounces; bounce++) {
        const distance = closest.intersection.distance; // Distance to the next intersection

        // Fresnel effect for angle-based reflectivity
        const fresnel = fresnelReflectivity(normal, direction, baseReflectivity);

        // Attenuate intensity based on material reflectivity, Fresnel effect, and distance
        intensity *= fresnel / (1 + distance * distance);

        // Break if intensity becomes negligible
        if (intensity < 0.01) {
            break;
        }
    }

    return intensity;
}

function fresnelReflectivity(normal, direction, baseReflectivity = 0.04) {
    const cosTheta = Math.abs(dotProduct(normal, direction));
    return baseReflectivity + (1 - baseReflectivity) * Math.pow(1 - cosTheta, 5);
}


function computeAverage(buffer, frameCount, width, height) {
    // Return a float buffer [0..1]
    const averagedBuffer = new Float32Array(width * height * 4);
    for (let i = 0; i < buffer.length; i++) {
        averagedBuffer[i] = buffer[i] / frameCount; // stays in floating-point
    }
    return averagedBuffer;
}


function accumulateFrame(buffer, frameData, width, height) {
    for (let i = 0; i < frameData.length; i++) {
        buffer[i] += frameData[i]; // Add pixel color to the buffer
    }
}

function toLinear(color) {
    return {
        r: Math.pow(color.r / 255, 2.2),
        g: Math.pow(color.g / 255, 2.2),
        b: Math.pow(color.b / 255, 2.2),
        a: color.a, // Alpha stays the same
    };
}

function toSRGB(color) {
    return {
        r: Math.pow(color.r, 1 / 2.2) * 255,
        g: Math.pow(color.g, 1 / 2.2) * 255,
        b: Math.pow(color.b, 1 / 2.2) * 255,
        a: color.a, // Alpha stays the same
    };
}
