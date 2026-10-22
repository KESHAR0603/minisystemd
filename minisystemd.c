#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <signal.h>
#include <stdbool.h>
#include <dirent.h>
#include <errno.h>

#define MAX_LINE 256
#define MAX_SERVICES 10
#define MAX_RETRIES 3
#define SOCKET_PATH "/tmp/minisystemd.sock"

struct ServiceConfig {
    char name[64];
    char exec_path[128];
    char arg[32];
    char after[64];
    char restart_policy[32];
    int in_degree;
    pid_t pid;
    int failures;
    bool is_running;
};

struct ServiceConfig services[MAX_SERVICES];
int service_count = 0;
volatile int active_services = 0;

// Parse unit file including Restart policy
bool parse_unit_file(const char *filename, struct ServiceConfig *config) {
    FILE *file = fopen(filename, "r");
    if (!file) return false;

    char line[MAX_LINE];
    while (fgets(line, sizeof(line), file)) {
        line[strcspn(line, "\r\n")] = 0;
        if (line[0] == '[' || line[0] == '#' || strlen(line) == 0) continue;

        char *key = strtok(line, "=");
        char *value = strtok(NULL, "=");

        if (key && value) {
            if (strcmp(key, "Name") == 0) {
                strncpy(config->name, value, sizeof(config->name) - 1);
            } 
            else if (strcmp(key, "ExecStart") == 0) {
                char *cmd = strtok(value, " ");
                char *arg = strtok(NULL, " ");
                if (cmd) strncpy(config->exec_path, cmd, sizeof(config->exec_path) - 1);
                if (arg) strncpy(config->arg, arg, sizeof(config->arg) - 1);
            }
            else if (strcmp(key, "After") == 0) {
                strncpy(config->after, value, sizeof(config->after) - 1);
            }
            else if (strcmp(key, "Restart") == 0) {
                strncpy(config->restart_policy, value, sizeof(config->restart_policy) - 1);
            }
        }
    }
    fclose(file);
    return true;
}

// Function to apply cgroups v2 hardware sandboxing

void setup_cgroups(const char *service_name, pid_t pid) {
    char cgroup_dir[256];
    char path_buf[512];

    snprintf(cgroup_dir, sizeof(cgroup_dir),
             "/sys/fs/cgroup/minisystemd_%s", service_name);

    if (mkdir(cgroup_dir, 0755) != 0 && errno != EEXIST) {
        fprintf(stderr,
                "[Cgroups v2] Sandbox unavailable for '%s': "
                "cannot create cgroup: %s\n",
                service_name, strerror(errno));
        return;
    }

    snprintf(path_buf, sizeof(path_buf), "%s/memory.max", cgroup_dir);

    FILE *f = fopen(path_buf, "w");
    if (!f) {
        fprintf(stderr,
                "[Cgroups v2] Memory limit NOT applied for '%s': %s\n",
                service_name, strerror(errno));
        return;
    }

    if (fprintf(f, "52428800\n") < 0 || fclose(f) != 0) {
        fprintf(stderr,
                "[Cgroups v2] Failed to configure memory limit for '%s'.\n",
                service_name);
        return;
    }

    snprintf(path_buf, sizeof(path_buf), "%s/cgroup.procs", cgroup_dir);

    f = fopen(path_buf, "w");
    if (!f) {
        fprintf(stderr,
                "[Cgroups v2] Could not move PID %d into cgroup '%s': %s\n",
                pid, service_name, strerror(errno));
        return;
    }

    if (fprintf(f, "%d\n", pid) < 0 || fclose(f) != 0) {
        fprintf(stderr,
                "[Cgroups v2] Failed to assign PID %d to cgroup '%s'.\n",
                pid, service_name);
        return;
    }

    printf("[Cgroups v2] Memory limit configured: 50 MiB for '%s'.\n",
           service_name);
}


// Function to launch or respawn a service
void launch_process(struct ServiceConfig *svc) {
    printf("[Loader] -> Starting service '%s' (%s %s)\n", svc->name, svc->exec_path, svc->arg);
    
    pid_t pid = fork();
    if (pid < 0) {
        perror("Fork failed");
    } 
    else if (pid == 0) {
        char *args[] = {svc->exec_path, svc->arg, NULL};
        execvp(args[0], args);
        perror("Exec failed");
        exit(1);
    } 
    else {
        svc->pid = pid;
        svc->is_running = true;
        active_services++;
        setup_cgroups(svc->name, pid);
    }
}

int main() {
    signal(SIGPIPE, SIG_IGN);
    printf("=== Mini-systemd Full Control Plane Engine (PID: %d) ===\n", getpid());

    DIR *dir = opendir("services");
    if (!dir) {
        perror("Failed to open services directory");
        return 1;
    }

    struct dirent *entry;
    while ((entry = readdir(dir)) != NULL && service_count < MAX_SERVICES) {
        if (strstr(entry->d_name, ".service") != NULL) {
            char filepath[512];
            snprintf(filepath, sizeof(filepath), "services/%s", entry->d_name);

            struct ServiceConfig svc;
            memset(&svc, 0, sizeof(svc));
            svc.in_degree = 0;
            svc.failures = 0;
            svc.is_running = false;
            strcpy(svc.restart_policy, "no");

            if (parse_unit_file(filepath, &svc)) {
                services[service_count++] = svc;
                printf("[Parser] Loaded service unit: '%s' (Restart=%s)\n", svc.name, svc.restart_policy);
            }
        }
    }
    closedir(dir);

    // BUILD DEPENDENCY GRAPH & TOPOLOGICAL SORT
    for (int i = 0; i < service_count; i++) {
        if (strlen(services[i].after) > 0) {
            for (int j = 0; j < service_count; j++) {
                if (strcmp(services[i].after, services[j].name) == 0) {
                    services[i].in_degree++;
                    break;
                }
            }
        }
    }

    struct ServiceConfig *sorted_services[MAX_SERVICES];
    int sorted_count = 0;
    bool processed[MAX_SERVICES] = {false};

    for (int step = 0; step < service_count; step++) {
        int candidate = -1;
        for (int i = 0; i < service_count; i++) {
            if (!processed[i] && services[i].in_degree == 0) {
                candidate = i;
                break;
            }
        }

        if (candidate == -1) {
            fprintf(stderr, "\n[FATAL ERROR] Circular Dependency / Deadlock Detected!\n");
            return 1;
        }

        processed[candidate] = true;
        sorted_services[sorted_count++] = &services[candidate];

        for (int i = 0; i < service_count; i++) {
            if (!processed[i] && strlen(services[i].after) > 0) {
                if (strcmp(services[i].after, services[candidate].name) == 0) {
                    services[i].in_degree--;
                }
            }
        }
    }

    // INITIALIZE UNIX DOMAIN SOCKET SERVER (Non-blocking)
    unlink(SOCKET_PATH);
    int server_fd = socket(AF_UNIX, SOCK_STREAM | SOCK_NONBLOCK, 0);
    struct sockaddr_un server_addr;
    memset(&server_addr, 0, sizeof(server_addr));
    server_addr.sun_family = AF_UNIX;
    strncpy(server_addr.sun_path, SOCKET_PATH, sizeof(server_addr.sun_path) - 1);

    bind(server_fd, (struct sockaddr*)&server_addr, sizeof(server_addr));
    listen(server_fd, 5);
    printf("[IPC Server] Unix Domain Socket active at %s\n", SOCKET_PATH);

    // Launch services in topological order without artificial delays.
    // Each fork returns promptly, allowing launched services to run concurrently.
    printf("\n[Daemon] Launching services in topological order "
           "(concurrent execution enabled)...\n");
    for (int i = 0; i < sorted_count; i++) {
        launch_process(sorted_services[i]);
    }

    printf("\n[Daemon] Entering Supervisor & IPC Control Plane Loop...\n");

    // SUPERVISOR & IPC MONITORING LOOP
    while (1) {
        // 1. Handle incoming minictl client requests
        int client_fd = accept(server_fd, NULL, NULL);
        if (client_fd >= 0) {
            char cmd_buf[256];
            int n = read(client_fd, cmd_buf, sizeof(cmd_buf) - 1);
            if (n > 0) {
                cmd_buf[n] = '\0';
                printf("[IPC Server] Received command from minictl: '%s'\n", cmd_buf);

               
if (strcmp(cmd_buf, "status") == 0) {
    char resp[512];
    int used = snprintf(resp, sizeof(resp),
                        "OK: Daemon active. Active services = %d\n",
                        active_services);

    for (int i = 0; i < service_count && used < (int)sizeof(resp) - 1; i++) {
        int written = snprintf(resp + used, sizeof(resp) - (size_t)used,
                               "%s: %s (PID=%d)\n",
                               services[i].name,
                               services[i].is_running ? "RUNNING" : "STOPPED",
                               (int)services[i].pid);

        if (written < 0) {
            break;
        }
        if (written >= (int)(sizeof(resp) - (size_t)used)) {
            used = (int)sizeof(resp) - 1;
            break;
        }
        used += written;
    }

    write(client_fd, resp, strlen(resp) + 1);
} else if (strncmp(cmd_buf, "start ", 6) == 0) {
    char service_name[64] = {0};

    if (sscanf(cmd_buf + 6, "%63s", service_name) != 1) {
        const char *resp = "ERROR: Usage: start <service_name>";
        write(client_fd, resp, strlen(resp) + 1);
    } else {
        struct ServiceConfig *target = NULL;

        for (int i = 0; i < service_count; i++) {
            if (strcmp(services[i].name, service_name) == 0) {
                target = &services[i];
                break;
            }
        }

        if (target == NULL) {
            const char *resp = "ERROR: Service not found";
            write(client_fd, resp, strlen(resp) + 1);
        } else if (target->is_running) {
            const char *resp = "INFO: Service is already running";
            write(client_fd, resp, strlen(resp) + 1);
        } else {
            target->failures = 0;
            launch_process(target);

            if (target->is_running) {
                char resp[160];
                snprintf(resp, sizeof(resp),
                         "OK: Started service '%s' (PID=%d)",
                         target->name, (int)target->pid);
                write(client_fd, resp, strlen(resp) + 1);
            } else {
                const char *resp = "ERROR: Failed to launch service";
                write(client_fd, resp, strlen(resp) + 1);
            }
        }
    }
} else {
    const char *resp = "ERROR: Unknown command";
    write(client_fd, resp, strlen(resp) + 1);
}

            }
            close(client_fd);
        }

        // 2. Handle process reaping & self-healing
        int status;
        pid_t pid = waitpid(-1, &status, WNOHANG);

        if (pid > 0) {
            printf("\n[Reaper] waitpid() collected terminated child PID %d; exit status retrieved.\n", pid);
            struct ServiceConfig *target = NULL;
            for (int i = 0; i < service_count; i++) {
                if (services[i].pid == pid) {
                    target = &services[i];
                    break;
                }
            }

            if (target) {
                target->is_running = false;
                active_services--;

                if (WIFEXITED(status)) {
                    int exit_code = WEXITSTATUS(status);
                    printf("\n[Supervisor] Service '%s' (PID %d) exited with code %d.\n", 
                           target->name, pid, exit_code);

                    if (exit_code != 0 && strcmp(target->restart_policy, "on-failure") == 0) {
                        if (target->failures < MAX_RETRIES) {
                            target->failures++;
                            int backoff_delay = 1 << (target->failures - 1); 
                            printf("[Self-Healing] Crash detected! Restarting '%s' in %d second(s) (Attempt %d/%d)...\n",
                                   target->name, backoff_delay, target->failures, MAX_RETRIES);
                            
                            sleep(backoff_delay);
                            launch_process(target);
                        } else {
                            fprintf(stderr, "[Self-Healing] Service '%s' exceeded max retry limit (%d). Giving up.\n",
                                    target->name, MAX_RETRIES);
                        }
                    }
                }
            }
        }
        usleep(100000);
    }

    close(server_fd);
    unlink(SOCKET_PATH);
    printf("\n=== All Managed Services Terminated. Mini-systemd Shutting Down Safely ===\n");
    return 0;
}
