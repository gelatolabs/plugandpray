/*
 * Minimal libretro frontend for running a single core inside WebAssembly.
 * The same file is linked against each core (SameBoy, PCSX ReARMed, Beetle VB); JS
 * drives it one frame at a time through the exported fe_* functions.
 */
#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>
#include "libretro.h"

#define MAX_W 1024
#define MAX_H 576
#define MAX_OPTIONS 64
#define AUDIO_FRAMES 8192 /* stereo frames in the ring buffer */

static uint32_t framebuffer[MAX_W * MAX_H]; /* RGBA8888, tightly packed */
static unsigned fb_width, fb_height;
static unsigned frame_counter;
static enum retro_pixel_format pixel_format = RETRO_PIXEL_FORMAT_0RGB1555;
static uint16_t joypad_mask[2];
static struct retro_system_av_info av_info;
static bool loaded;

static int16_t audio_ring[AUDIO_FRAMES * 2];
static unsigned audio_write, audio_read;

static struct { char key[64]; char value[64]; } options[MAX_OPTIONS];
static int option_count;

static void log_cb(enum retro_log_level level, const char *fmt, ...)
{
    if (level < RETRO_LOG_WARN) return;
    va_list ap;
    va_start(ap, fmt);
    vfprintf(stderr, fmt, ap);
    va_end(ap);
}

EMSCRIPTEN_KEEPALIVE void fe_set_option(const char *key, const char *value)
{
    for (int i = 0; i < option_count; i++) {
        if (!strcmp(options[i].key, key)) {
            snprintf(options[i].value, sizeof(options[i].value), "%s", value);
            return;
        }
    }
    if (option_count == MAX_OPTIONS) return;
    snprintf(options[option_count].key, sizeof(options[0].key), "%s", key);
    snprintf(options[option_count].value, sizeof(options[0].value), "%s", value);
    option_count++;
}

static bool environment_cb(unsigned cmd, void *data)
{
    switch (cmd) {
        case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT:
            pixel_format = *(enum retro_pixel_format *)data;
            return true;
        case RETRO_ENVIRONMENT_GET_LOG_INTERFACE:
            ((struct retro_log_callback *)data)->log = log_cb;
            return true;
        case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY:
        case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY:
            *(const char **)data = "/system";
            return true;
        case RETRO_ENVIRONMENT_GET_CAN_DUPE:
            *(bool *)data = true;
            return true;
        case RETRO_ENVIRONMENT_GET_INPUT_BITMASKS:
            return true;
        case RETRO_ENVIRONMENT_GET_TARGET_SAMPLE_RATE:
            /* what the browser plays at; otherwise SameBoy runs at 2 MHz */
            *(unsigned *)data = 48000;
            return true;
        case RETRO_ENVIRONMENT_GET_VARIABLE: {
            struct retro_variable *var = data;
            for (int i = 0; i < option_count; i++) {
                if (!strcmp(options[i].key, var->key)) {
                    var->value = options[i].value;
                    return true;
                }
            }
            var->value = NULL;
            return false;
        }
        case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE:
            *(bool *)data = false;
            return true;
        case RETRO_ENVIRONMENT_SET_SYSTEM_AV_INFO:
            av_info = *(const struct retro_system_av_info *)data;
            return true;
        case RETRO_ENVIRONMENT_SET_GEOMETRY:
            av_info.geometry = *(const struct retro_game_geometry *)data;
            return true;
        case RETRO_ENVIRONMENT_GET_CORE_OPTIONS_VERSION:
            *(unsigned *)data = 0;
            return true;
        case RETRO_ENVIRONMENT_SET_VARIABLES:
        case RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS:
        case RETRO_ENVIRONMENT_SET_CONTROLLER_INFO:
        case RETRO_ENVIRONMENT_SET_MEMORY_MAPS:
        case RETRO_ENVIRONMENT_SET_SUPPORT_NO_GAME:
        case RETRO_ENVIRONMENT_SET_PERFORMANCE_LEVEL:
            return true;
        default:
            return false;
    }
}

static void video_cb(const void *data, unsigned width, unsigned height, size_t pitch)
{
    frame_counter++;
    if (!data) return; /* duped frame: keep the previous one */
    if (width > MAX_W) width = MAX_W;
    if (height > MAX_H) height = MAX_H;
    fb_width = width;
    fb_height = height;
    for (unsigned y = 0; y < height; y++) {
        uint32_t *out = framebuffer + y * width;
        const uint8_t *row = (const uint8_t *)data + y * pitch;
        if (pixel_format == RETRO_PIXEL_FORMAT_XRGB8888) {
            const uint32_t *in = (const uint32_t *)row;
            for (unsigned x = 0; x < width; x++) {
                uint32_t p = in[x];
                out[x] = 0xFF000000u | ((p & 0xFF) << 16) | (p & 0xFF00) | ((p >> 16) & 0xFF);
            }
        } else if (pixel_format == RETRO_PIXEL_FORMAT_RGB565) {
            const uint16_t *in = (const uint16_t *)row;
            for (unsigned x = 0; x < width; x++) {
                uint16_t p = in[x];
                uint32_t r = (p >> 11) & 0x1F, g = (p >> 5) & 0x3F, b = p & 0x1F;
                r = (r << 3) | (r >> 2); g = (g << 2) | (g >> 4); b = (b << 3) | (b >> 2);
                out[x] = 0xFF000000u | (b << 16) | (g << 8) | r;
            }
        } else {
            const uint16_t *in = (const uint16_t *)row;
            for (unsigned x = 0; x < width; x++) {
                uint16_t p = in[x];
                uint32_t r = (p >> 10) & 0x1F, g = (p >> 5) & 0x1F, b = p & 0x1F;
                r = (r << 3) | (r >> 2); g = (g << 3) | (g >> 2); b = (b << 3) | (b >> 2);
                out[x] = 0xFF000000u | (b << 16) | (g << 8) | r;
            }
        }
    }
}

static size_t audio_batch_cb(const int16_t *data, size_t frames)
{
    for (size_t i = 0; i < frames; i++) {
        unsigned next = (audio_write + 1) % AUDIO_FRAMES;
        if (next == audio_read) break; /* full: drop */
        audio_ring[audio_write * 2] = data[i * 2];
        audio_ring[audio_write * 2 + 1] = data[i * 2 + 1];
        audio_write = next;
    }
    return frames;
}

static void audio_cb(int16_t left, int16_t right)
{
    int16_t s[2] = { left, right };
    audio_batch_cb(s, 1);
}

static void input_poll_cb(void) {}

static int16_t input_state_cb(unsigned port, unsigned device, unsigned index, unsigned id)
{
    if (port > 1 || (device & RETRO_DEVICE_MASK) != RETRO_DEVICE_JOYPAD) return 0;
    if (id == RETRO_DEVICE_ID_JOYPAD_MASK) return joypad_mask[port];
    return (joypad_mask[port] >> id) & 1;
}

EMSCRIPTEN_KEEPALIVE int fe_init(void)
{
    retro_set_environment(environment_cb);
    retro_set_video_refresh(video_cb);
    retro_set_audio_sample(audio_cb);
    retro_set_audio_sample_batch(audio_batch_cb);
    retro_set_input_poll(input_poll_cb);
    retro_set_input_state(input_state_cb);
    retro_init();
    return RETRO_API_VERSION;
}

EMSCRIPTEN_KEEPALIVE int fe_load(const char *path)
{
    FILE *f = fopen(path, "rb");
    if (!f) return 0;
    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);
    void *buf = malloc(size);
    fread(buf, 1, size, f);
    fclose(f);

    struct retro_game_info info = { path, buf, (size_t)size, NULL };
    loaded = retro_load_game(&info);
    if (loaded) {
        retro_get_system_av_info(&av_info);
        retro_set_controller_port_device(0, RETRO_DEVICE_JOYPAD);
    }
    return loaded;
}

EMSCRIPTEN_KEEPALIVE void fe_run(void) { if (loaded) retro_run(); }
EMSCRIPTEN_KEEPALIVE void fe_reset(void) { if (loaded) retro_reset(); }
EMSCRIPTEN_KEEPALIVE void fe_set_input(int port, int mask) { if (port >= 0 && port < 2) joypad_mask[port] = mask; }
EMSCRIPTEN_KEEPALIVE uint32_t *fe_frame(void) { return framebuffer; }
EMSCRIPTEN_KEEPALIVE unsigned fe_width(void) { return fb_width; }
EMSCRIPTEN_KEEPALIVE unsigned fe_height(void) { return fb_height; }
EMSCRIPTEN_KEEPALIVE unsigned fe_frame_count(void) { return frame_counter; }
EMSCRIPTEN_KEEPALIVE double fe_fps(void) { return av_info.timing.fps; }
EMSCRIPTEN_KEEPALIVE double fe_sample_rate(void) { return av_info.timing.sample_rate; }
EMSCRIPTEN_KEEPALIVE void *fe_memory(unsigned id) { return retro_get_memory_data(id); }
EMSCRIPTEN_KEEPALIVE unsigned fe_memory_size(unsigned id) { return retro_get_memory_size(id); }

/* Copies up to max stereo frames of queued audio into out; returns frames copied. */
EMSCRIPTEN_KEEPALIVE unsigned fe_audio_read(int16_t *out, unsigned max)
{
    unsigned n = 0;
    while (n < max && audio_read != audio_write) {
        out[n * 2] = audio_ring[audio_read * 2];
        out[n * 2 + 1] = audio_ring[audio_read * 2 + 1];
        audio_read = (audio_read + 1) % AUDIO_FRAMES;
        n++;
    }
    return n;
}
